"""Five-level validation (source, geography, variable, feature, experiment).

Each check returns a CheckResult; callers persist them to
audit.validation_results and route failures to quarantine. See
docs/validation.md for the full checklist.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from typing import Any

import pandas as pd

from engine.contracts import SourceContract
from engine.normalisation.geography import AUTHORITATIVE_METHODS, valid_county_fips
from engine.normalisation.normalise import ParsedRecord


@dataclass
class CheckResult:
    level: str
    check_name: str
    passed: bool
    severity: str = "error"
    observed: Any = None
    expected: Any = None

    def as_dict(self) -> dict:
        return self.__dict__.copy()


@dataclass
class ValidationReport:
    subject: str
    checks: list[CheckResult] = field(default_factory=list)

    @property
    def passed(self) -> bool:
        return all(c.passed for c in self.checks if c.severity == "error")

    def add(self, *results: CheckResult) -> None:
        self.checks.extend(results)


# --- Level 1: source validation -------------------------------------------

def validate_source_batch(
    contract: SourceContract, records: list[ParsedRecord], observed_fields: list[str]
) -> ValidationReport:
    report = ValidationReport(subject=contract.source_id)
    v = contract.validation

    report.add(
        CheckResult("source", "rows_present", len(records) > 0, observed=len(records), expected=">0")
    )

    # schema matches contract: every mapped source field appears
    expected_fields = set(contract.field_map.values()) if contract.field_map else set()
    if expected_fields:
        missing = sorted(expected_fields - set(observed_fields))
        report.add(
            CheckResult(
                "source", "schema_matches_contract", not missing,
                observed={"missing": missing}, expected=sorted(expected_fields),
            )
        )

    # numeric fields parse
    for fld in v.numeric_fields:
        bad = 0
        seen = 0
        for r in records:
            if fld in r.values and r.values[fld] not in (None, "", "-"):
                seen += 1
                try:
                    float(str(r.values[fld]).replace(",", ""))
                except ValueError:
                    bad += 1
        report.add(
            CheckResult(
                "source", f"numeric_parse:{fld}", bad == 0,
                observed={"unparseable": bad, "seen": seen},
            )
        )

    # bounds
    for fld, (lo, hi) in v.bounds.items():
        out_of_bounds = 0
        for r in records:
            raw_val = r.values.get(fld)
            try:
                val = float(str(raw_val).replace(",", ""))
            except (TypeError, ValueError):
                continue
            if (lo is not None and val < lo) or (hi is not None and val > hi):
                out_of_bounds += 1
        report.add(
            CheckResult(
                "source", f"bounds:{fld}", out_of_bounds == 0, severity="warning",
                observed={"out_of_bounds": out_of_bounds}, expected=[lo, hi],
            )
        )

    # date fields parse
    if v.required_time_parse and contract.time_grain != "static":
        unparsed = sum(1 for r in records if r.period_start is None)
        report.add(
            CheckResult("source", "time_parse", unparsed == 0, observed={"unparsed": unparsed})
        )
    return report


# --- Level 2: geography validation ----------------------------------------

def validate_geography(
    contract: SourceContract,
    join_methods: list[str],
    joined_fips: list[str],
    *,
    active_county_count: int,
) -> ValidationReport:
    report = ValidationReport(subject=contract.source_id)
    total = len(join_methods)
    matched = sum(1 for m in join_methods if m in AUTHORITATIVE_METHODS)

    report.add(
        CheckResult(
            "geography", "fips_valid",
            all(valid_county_fips(f) for f in joined_fips),
            observed={"joined": len(joined_fips)},
        )
    )
    rate = matched / total if total else 0.0
    report.add(
        CheckResult(
            "geography", "county_join_rate", rate >= 0.95, severity="warning",
            observed={"match_rate": round(rate, 4), "matched": matched, "total": total},
            expected=">=0.95",
        )
    )
    distinct = len(set(joined_fips))
    minimum = contract.validation.county_coverage_minimum
    coverage_ok = distinct >= min(minimum, active_county_count) or contract.validation.allow_missing_counties
    report.add(
        CheckResult(
            "geography", "county_coverage", coverage_ok,
            severity="warning" if contract.validation.allow_missing_counties else "error",
            observed={"distinct_counties": distinct},
            expected={"minimum": minimum, "active_counties": active_county_count},
        )
    )
    return report


def duplicate_county_periods(observations: pd.DataFrame) -> pd.DataFrame:
    """Duplicate (county, period, variable) rows — a geography-level failure."""
    key = ["county_fips", "period_start", "variable_id"]
    return observations[observations.duplicated(subset=key, keep=False)]


# --- Level 3: variable validation -----------------------------------------

def validate_variables(observations: pd.DataFrame, *, freshness_days: int | None = None,
                       reference_date: date | None = None) -> ValidationReport:
    report = ValidationReport(subject="norm")
    if observations.empty:
        report.add(CheckResult("variable", "observations_present", False, observed=0))
        return report
    for variable_id, grp in observations.groupby("variable_id"):
        null_rate = float(grp["value_numeric"].isna().mean())
        report.add(
            CheckResult(
                "variable", f"missingness:{variable_id}", null_rate < 0.5,
                severity="warning", observed={"null_rate": round(null_rate, 4)},
            )
        )
        units = grp["unit"].nunique()
        report.add(
            CheckResult(
                "variable", f"unit_consistent:{variable_id}", units == 1,
                observed={"distinct_units": units},
            )
        )
    return report


# --- Level 4: feature validation ------------------------------------------

def validate_features(feature_matrix: pd.DataFrame, feature_definitions: list[dict]) -> ValidationReport:
    report = ValidationReport(subject="feature_matrix")
    defined = {fd["feature_id"] for fd in feature_definitions}
    produced = set(feature_matrix["feature_id"].unique()) if not feature_matrix.empty else set()
    report.add(
        CheckResult(
            "feature", "features_produced", bool(produced),
            observed={"produced": len(produced), "defined": len(defined)},
        )
    )
    unknown = sorted(produced - defined)
    report.add(
        CheckResult("feature", "no_undeclared_features", not unknown, observed={"unknown": unknown})
    )
    for fid in sorted(produced):
        vals = feature_matrix.loc[feature_matrix["feature_id"] == fid, "feature_value"]
        all_null = bool(vals.isna().all())
        report.add(
            CheckResult(
                "feature", f"not_all_null:{fid}", not all_null, severity="warning",
                observed={"null_rate": round(float(vals.isna().mean()), 4)},
            )
        )
    return report


# --- Level 5: experiment validation ---------------------------------------

def validate_experiment(result) -> ValidationReport:
    """`result` is engine.experiments.engine.ExperimentResult."""
    report = ValidationReport(subject=result.event_id)
    report.add(
        CheckResult("experiment", "cases_present", result.case_count >= 5,
                    observed=result.case_count, expected=">=5"),
        CheckResult("experiment", "controls_present", result.control_count >= result.case_count,
                    observed=result.control_count, expected=">=case_count"),
        CheckResult("experiment", "baseline_compared",
                    any(m.is_baseline for m in result.models),
                    observed=[m.model_type for m in result.models]),
        CheckResult("experiment", "trigger_feature_excluded",
                    bool(result.diagnostics.get("trigger_feature_excluded")),
                    observed=result.diagnostics.get("trigger_feature_excluded")),
        CheckResult("experiment", "features_precede_label",
                    bool(result.diagnostics.get("features_precede_label")),
                    observed=result.diagnostics.get("prediction_horizon_months")),
    )
    best = result.best_model
    auc = best.metrics.get("auc")
    report.add(
        CheckResult("experiment", "auc_computed", auc is not None and auc == auc,
                    observed=auc)
    )
    return report
