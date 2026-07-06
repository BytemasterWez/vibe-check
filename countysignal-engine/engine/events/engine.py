"""Event engine: evaluates declared event contracts over the feature matrix.

Events are configuration (contracts/events/*.yaml), never code. An event
condition references a transform of its base variable; the engine finds the
matching feature series and applies operator/threshold to produce
occurrences, then builds case/control sets for the experiment engine.
"""

from __future__ import annotations

import operator as op
from dataclasses import dataclass, field

import pandas as pd

from engine.contracts import EventContract

_OPS = {">=": op.ge, "<=": op.le, ">": op.gt, "<": op.lt, "==": op.eq}


@dataclass
class Occurrence:
    event_id: str
    county_fips: str
    period: pd.Timestamp
    trigger_value: float


@dataclass
class CaseControlSet:
    event_id: str
    cases: list[dict] = field(default_factory=list)       # {county_fips, period}
    controls: list[dict] = field(default_factory=list)
    excluded: list[dict] = field(default_factory=list)    # {county_fips, period, reason}

    def diagnostics(self) -> dict:
        case_states = {c["county_fips"][:2] for c in self.cases}
        control_states = {c["county_fips"][:2] for c in self.controls}
        return {
            "case_count": len(self.cases),
            "control_count": len(self.controls),
            "excluded_count": len(self.excluded),
            "case_state_count": len(case_states),
            "control_state_count": len(control_states),
            "control_case_ratio": (len(self.controls) / len(self.cases)) if self.cases else None,
        }


def condition_feature_id(event: EventContract) -> str:
    return f"{event.base_variable}__{event.condition.transform}"


def detect_occurrences(
    event: EventContract,
    feature_matrix: pd.DataFrame,
    observations: pd.DataFrame | None = None,
) -> list[Occurrence]:
    """Apply the event condition to the matching feature series.

    observations (long: county_fips, period, variable_id, value) is used to
    enforce minimum_history_months; pass None to skip that check.
    """
    feature_id = condition_feature_id(event)
    series = feature_matrix[feature_matrix["feature_id"] == feature_id].copy()
    if series.empty:
        raise ValueError(
            f"event {event.event_id}: feature {feature_id} not present in the "
            "feature matrix — add the transform to the feature config"
        )
    series["period"] = pd.to_datetime(series["period"])

    history_ok: dict[str, pd.Timestamp] | None = None
    if observations is not None and event.minimum_history_months > 0:
        base = observations[observations["variable_id"] == event.base_variable]
        first_period = base.groupby("county_fips")["period"].min()
        history_ok = (
            pd.to_datetime(first_period) + pd.DateOffset(months=event.minimum_history_months)
        ).to_dict()

    compare = _OPS[event.condition.operator]
    occurrences: list[Occurrence] = []
    hits = series[compare(series["feature_value"], event.condition.threshold)]
    for row in hits.itertuples(index=False):
        if history_ok is not None:
            earliest_valid = history_ok.get(row.county_fips)
            if earliest_valid is None or row.period < earliest_valid:
                continue
        occurrences.append(
            Occurrence(
                event_id=event.event_id,
                county_fips=row.county_fips,
                period=row.period,
                trigger_value=float(row.feature_value),
            )
        )
    return occurrences


def build_case_control_set(
    event: EventContract,
    occurrences: list[Occurrence],
    feature_matrix: pd.DataFrame,
    *,
    random_state: int = 42,
) -> CaseControlSet:
    """Cases: first occurrence per county. Controls: county-periods where the
    condition feature exists but never triggers, sampled at case periods."""
    result = CaseControlSet(event_id=event.event_id)
    feature_id = condition_feature_id(event)
    series = feature_matrix[feature_matrix["feature_id"] == feature_id].copy()
    series["period"] = pd.to_datetime(series["period"])

    event_counties = {o.county_fips for o in occurrences}

    first_by_county: dict[str, Occurrence] = {}
    for o in sorted(occurrences, key=lambda o: o.period):
        first_by_county.setdefault(o.county_fips, o)
    for o in first_by_county.values():
        result.cases.append({"county_fips": o.county_fips, "period": str(o.period.date())})

    case_periods = sorted({o.period for o in first_by_county.values()})
    eligible = series[
        ~series["county_fips"].isin(event_counties)
        & series["period"].isin(case_periods)
        & series["feature_value"].notna()
    ]

    max_controls = event.case_control.max_controls_per_case * max(len(result.cases), 1)
    sampled = eligible.sample(
        n=min(max_controls, len(eligible)), random_state=random_state
    ) if len(eligible) else eligible
    for row in sampled.itertuples(index=False):
        result.controls.append(
            {"county_fips": row.county_fips, "period": str(row.period.date())}
        )

    # Counties with the feature entirely missing at case periods are excluded
    # (not silently ignored).
    seen = event_counties | {c["county_fips"] for c in result.controls}
    all_counties = set(series["county_fips"].unique())
    for fips in sorted(all_counties - seen):
        result.excluded.append(
            {"county_fips": fips, "period": None, "reason": "not_sampled_or_missing_feature"}
        )
    return result
