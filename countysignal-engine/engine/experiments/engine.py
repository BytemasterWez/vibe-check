"""Experiment engine: case/control scoring experiments with baselines.

Deliberately simple (per the design brief): logistic regression and random
forest against naive baselines, time-based train/test split, ROC AUC,
precision@k / recall@k, and feature rankings. Every experiment MUST beat or
be compared against a baseline; leakage checks run on every experiment.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score

from engine.contracts import EventContract
from engine.events.engine import CaseControlSet, condition_feature_id
from engine.features.engine import matrix_as_of


@dataclass
class ModelResult:
    model_type: str
    is_baseline: bool
    metrics: dict[str, float] = field(default_factory=dict)   # name -> value
    rankings: list[dict] = field(default_factory=list)        # {feature_id, rank, importance, direction}
    model: object | None = None
    feature_ids: list[str] = field(default_factory=list)
    train_means: dict[str, float] = field(default_factory=dict)
    train_stds: dict[str, float] = field(default_factory=dict)


@dataclass
class ExperimentResult:
    event_id: str
    case_count: int
    control_count: int
    train_period: str
    test_period: str
    models: list[ModelResult] = field(default_factory=list)
    diagnostics: dict = field(default_factory=dict)

    @property
    def best_model(self) -> ModelResult:
        candidates = [m for m in self.models if not m.is_baseline] or self.models
        return max(candidates, key=lambda m: m.metrics.get("auc", 0.0))

    @property
    def top_variables(self) -> list[dict]:
        return self.best_model.rankings[:15]


def assemble_design_matrix(
    case_control: CaseControlSet,
    feature_matrix: pd.DataFrame,
    *,
    prediction_horizon_months: int,
    exclude_features: set[str] | None = None,
) -> pd.DataFrame:
    """Label matrix: features observed `prediction_horizon_months` BEFORE the
    labelled period (leakage guard — matrix_as_of only looks backward)."""
    rows = []
    for role, members in (("case", case_control.cases), ("control", case_control.controls)):
        for m in members:
            rows.append(
                {
                    "county_fips": m["county_fips"],
                    "label_period": pd.Timestamp(m["period"]),
                    "y": 1 if role == "case" else 0,
                }
            )
    labels = pd.DataFrame(rows)
    if labels.empty:
        return labels

    parts = []
    for label_period, grp in labels.groupby("label_period"):
        as_of = label_period - pd.DateOffset(months=prediction_horizon_months)
        wide = matrix_as_of(feature_matrix, as_of)
        merged = grp.merge(wide, on="county_fips", how="left")
        parts.append(merged)
    design = pd.concat(parts, ignore_index=True)
    if exclude_features:
        design = design.drop(columns=[c for c in exclude_features if c in design.columns])
    return design


def _feature_columns(design: pd.DataFrame) -> list[str]:
    return [c for c in design.columns if c not in ("county_fips", "label_period", "y")]


def _precision_recall_at_k(y_true: np.ndarray, y_score: np.ndarray, k: int) -> tuple[float, float]:
    k = min(k, len(y_score))
    if k == 0 or y_true.sum() == 0:
        return 0.0, 0.0
    top_k = np.argsort(-y_score)[:k]
    hits = y_true[top_k].sum()
    return float(hits / k), float(hits / y_true.sum())


def _evaluate(y_true: np.ndarray, y_score: np.ndarray, ks: tuple[int, ...]) -> dict[str, float]:
    metrics: dict[str, float] = {}
    if len(np.unique(y_true)) > 1:
        metrics["auc"] = float(roc_auc_score(y_true, y_score))
    else:
        metrics["auc"] = float("nan")
    for k in ks:
        p, r = _precision_recall_at_k(y_true, y_score, k)
        metrics[f"precision_at_{k}"] = p
        metrics[f"recall_at_{k}"] = r
    return metrics


def run_experiment(
    event: EventContract,
    case_control: CaseControlSet,
    feature_matrix: pd.DataFrame,
    *,
    prediction_horizon_months: int = 6,
    test_fraction: float = 0.3,
    ks: tuple[int, ...] = (10, 25, 50),
    model_types: tuple[str, ...] = ("logistic_regression", "random_forest"),
    random_state: int = 42,
) -> ExperimentResult:
    """Time-split experiment: train on early label periods, test on late ones."""
    # The event's own trigger feature is excluded from the design matrix: it
    # *defines* the label, so leaving it in would be near-direct leakage.
    trigger = condition_feature_id(event)
    design = assemble_design_matrix(
        case_control,
        feature_matrix,
        prediction_horizon_months=prediction_horizon_months,
        exclude_features={trigger},
    )
    if design.empty or design["y"].nunique() < 2:
        raise ValueError(
            f"experiment for {event.event_id}: need both cases and controls "
            f"(cases={len(case_control.cases)}, controls={len(case_control.controls)})"
        )

    # Train/test split BY TIME: no shuffling across periods.
    periods = sorted(design["label_period"].unique())
    split_idx = max(1, int(round(len(periods) * (1 - test_fraction))))
    train_periods, test_periods = periods[:split_idx], periods[split_idx:]
    if not test_periods:  # single-period experiments fall back to a row split
        design = design.sample(frac=1.0, random_state=random_state).reset_index(drop=True)
        cut = int(len(design) * (1 - test_fraction))
        train, test = design.iloc[:cut], design.iloc[cut:]
        train_label = test_label = str(pd.Timestamp(periods[0]).date())
    else:
        train = design[design["label_period"].isin(train_periods)]
        test = design[design["label_period"].isin(test_periods)]
        train_label = f"{pd.Timestamp(train_periods[0]).date()}..{pd.Timestamp(train_periods[-1]).date()}"
        test_label = f"{pd.Timestamp(test_periods[0]).date()}..{pd.Timestamp(test_periods[-1]).date()}"
    if test.empty or test["y"].nunique() < 2 or train["y"].nunique() < 2:
        raise ValueError(
            f"experiment for {event.event_id}: train/test split left a "
            "degenerate partition — need more periods or more cases"
        )

    feature_ids = _feature_columns(design)
    result = ExperimentResult(
        event_id=event.event_id,
        case_count=int(design["y"].sum()),
        control_count=int((design["y"] == 0).sum()),
        train_period=train_label,
        test_period=test_label,
    )

    means = train[feature_ids].mean()
    stds = train[feature_ids].std().replace(0, 1.0).fillna(1.0)

    def prep(frame: pd.DataFrame) -> np.ndarray:
        return ((frame[feature_ids] - means) / stds).fillna(0.0).to_numpy()

    X_train, y_train = prep(train), train["y"].to_numpy()
    X_test, y_test = prep(test), test["y"].to_numpy()

    # --- Baselines (every experiment compares against these) ---
    rate = y_train.mean()
    result.models.append(
        ModelResult(
            model_type="baseline_national_average",
            is_baseline=True,
            metrics=_evaluate(y_test, np.full(len(y_test), rate), ks),
        )
    )
    # Baseline: score by the base variable's own recent level (single feature)
    base_latest = f"{event.base_variable}__latest_value"
    if base_latest in feature_ids:
        col = test[base_latest].fillna(train[base_latest].mean()).to_numpy()
        result.models.append(
            ModelResult(
                model_type="baseline_previous_value",
                is_baseline=True,
                metrics=_evaluate(y_test, col, ks),
            )
        )

    # --- Real models ---
    for model_type in model_types:
        if model_type == "logistic_regression":
            model = LogisticRegression(max_iter=2000, random_state=random_state)
        elif model_type in ("random_forest", "gradient_boosting"):
            model = RandomForestClassifier(
                n_estimators=200, min_samples_leaf=3, random_state=random_state
            )
        else:
            raise ValueError(f"unsupported model type: {model_type}")
        model.fit(X_train, y_train)
        scores = model.predict_proba(X_test)[:, 1]
        mr = ModelResult(
            model_type=model_type,
            is_baseline=False,
            metrics=_evaluate(y_test, scores, ks),
            model=model,
            feature_ids=feature_ids,
            train_means=means.to_dict(),
            train_stds=stds.to_dict(),
        )
        if hasattr(model, "coef_"):
            importances = model.coef_[0]
        else:
            importances = model.feature_importances_
        order = np.argsort(-np.abs(importances))
        mr.rankings = [
            {
                "feature_id": feature_ids[i],
                "rank": rank + 1,
                "importance": float(importances[i]),
                "direction": "positive" if importances[i] >= 0 else "negative",
            }
            for rank, i in enumerate(order)
        ]
        result.models.append(mr)

    result.diagnostics = leakage_checks(event, design, feature_ids, prediction_horizon_months)
    result.diagnostics.update(case_control.diagnostics())
    return result


def leakage_checks(
    event: EventContract,
    design: pd.DataFrame,
    feature_ids: list[str],
    prediction_horizon_months: int,
) -> dict:
    """Structural leakage checks recorded with every experiment."""
    trigger = condition_feature_id(event)
    return {
        "trigger_feature_excluded": trigger not in feature_ids,
        "prediction_horizon_months": prediction_horizon_months,
        "features_precede_label": prediction_horizon_months > 0,
        "n_features": len(feature_ids),
        "null_share": float(design[feature_ids].isna().mean().mean()) if feature_ids else None,
    }
