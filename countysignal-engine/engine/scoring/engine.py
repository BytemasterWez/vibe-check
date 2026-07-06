"""Scoring engine: applies a trained experiment model to the latest feature
matrix for all counties, producing ranked, evidence-backed county scores.

A recipe may only claim a score if the supporting variables exist in the
source store: scores carry the exact feature values used (evidence_json)
and the model/experiment version that produced them.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from engine.contracts import RecipeContract
from engine.experiments.engine import ModelResult


@dataclass
class CountyScore:
    county_fips: str
    period: str
    score: float
    rank_national: int
    rank_state: int
    confidence: str
    top_positive_factors: list[dict] = field(default_factory=list)
    top_negative_factors: list[dict] = field(default_factory=list)
    evidence: dict = field(default_factory=dict)


def score_counties(
    recipe: RecipeContract,
    model_result: ModelResult,
    latest_features: pd.DataFrame,   # wide frame from matrix_as_of()
    *,
    period: str,
    model_version: str,
    top_n_factors: int = 3,
) -> list[CountyScore]:
    if model_result.model is None:
        raise ValueError("model_result carries no trained model (baselines cannot score)")

    feature_ids = [f for f in model_result.feature_ids if f in latest_features.columns]
    if not feature_ids:
        raise ValueError("latest feature matrix shares no features with the trained model")

    frame = latest_features[["county_fips"] + feature_ids].copy()
    means = pd.Series(model_result.train_means).reindex(feature_ids).fillna(0.0)
    stds = pd.Series(model_result.train_stds).reindex(feature_ids).replace(0, 1.0).fillna(1.0)
    standardized = ((frame[feature_ids] - means) / stds).fillna(0.0)

    # Missing model features (in model but absent from the latest matrix)
    # contribute 0 after standardisation — note it in confidence.
    missing = [f for f in model_result.feature_ids if f not in latest_features.columns]
    X = np.zeros((len(frame), len(model_result.feature_ids)))
    for j, f in enumerate(model_result.feature_ids):
        if f in standardized.columns:
            X[:, j] = standardized[f].to_numpy()

    probs = model_result.model.predict_proba(X)[:, 1]
    null_share = frame[feature_ids].isna().mean(axis=1)

    if hasattr(model_result.model, "coef_"):
        coefs = model_result.model.coef_[0]
        contributions = X * coefs  # per-county, per-feature contribution
    else:
        importances = model_result.model.feature_importances_
        contributions = X * importances

    frame["score"] = probs
    frame["rank_national"] = frame["score"].rank(ascending=False, method="min").astype(int)
    state = frame["county_fips"].str[:2]
    frame["rank_state"] = (
        frame.groupby(state)["score"].rank(ascending=False, method="min").astype(int)
    )

    out: list[CountyScore] = []
    for i, row in enumerate(frame.itertuples(index=False)):
        contrib = contributions[i]
        order = np.argsort(-contrib)
        positives = [
            {
                "feature_id": model_result.feature_ids[j],
                "contribution": round(float(contrib[j]), 4),
                "value": _safe_value(frame, i, model_result.feature_ids[j]),
            }
            for j in order[:top_n_factors]
            if contrib[j] > 0
        ]
        negatives = [
            {
                "feature_id": model_result.feature_ids[j],
                "contribution": round(float(contrib[j]), 4),
                "value": _safe_value(frame, i, model_result.feature_ids[j]),
            }
            for j in order[::-1][:top_n_factors]
            if contrib[j] < 0
        ]
        confidence = "high" if null_share.iloc[i] < 0.2 else (
            "medium" if null_share.iloc[i] < 0.5 else "low"
        )
        out.append(
            CountyScore(
                county_fips=row.county_fips,
                period=period,
                score=round(float(row.score), 6),
                rank_national=int(row.rank_national),
                rank_state=int(row.rank_state),
                confidence=confidence,
                top_positive_factors=positives,
                top_negative_factors=negatives,
                evidence={
                    "recipe_id": recipe.recipe_id,
                    "event_id": recipe.event_id,
                    "model_version": model_version,
                    "feature_null_share": round(float(null_share.iloc[i]), 4),
                    "missing_model_features": missing,
                    "features_used": {
                        f: _safe_value(frame, i, f) for f in feature_ids
                    },
                },
            )
        )
    return out


def _safe_value(frame: pd.DataFrame, i: int, feature_id: str):
    if feature_id not in frame.columns:
        return None
    v = frame[feature_id].iloc[i]
    return None if pd.isna(v) else round(float(v), 6)
