"""Generic source→norm normaliser.

Adapters parse source rows into ParsedRecords (source-native values plus
geography hints). This module joins them to ref.counties via the join
hierarchy and emits canonical county-time observations. Anything that fails
the join or basic checks becomes a quarantine entry — nothing disappears.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from typing import Any, Optional

from engine.contracts import SourceContract, VariableContract
from engine.normalisation.geography import (
    MATCH_CANDIDATE_FUZZY,
    CountyIndex,
    JoinResult,
    join_county,
)
from engine.provenance import build_provenance


@dataclass
class ParsedRecord:
    """One source row after parsing, before geography resolution."""

    source_record_id: str
    source_row_hash: str
    period_start: Optional[date]
    period_end: Optional[date]
    values: dict[str, Any]                 # source_field -> value
    geography: dict[str, Any] = field(default_factory=dict)  # kwargs for join_county
    raw: dict[str, Any] = field(default_factory=dict)


@dataclass
class Observation:
    """Canonical normalised observation, ready for norm.* insert."""

    county_fips: str
    period_start: Optional[date]
    period_end: Optional[date]
    variable_id: str
    value_numeric: Optional[float]
    unit: str
    source_id: str
    source_version: str
    confidence: str
    provenance_json: dict
    time_grain: str
    value_text: Optional[str] = None


@dataclass
class QuarantineEntry:
    stage: str
    reason: str
    record: dict
    source_record_id: Optional[str] = None
    join_candidate: Optional[JoinResult] = None


@dataclass
class NormalizationResult:
    observations: list[Observation] = field(default_factory=list)
    quarantined: list[QuarantineEntry] = field(default_factory=list)
    join_results: list[JoinResult] = field(default_factory=list)


def _to_float(value: Any) -> Optional[float]:
    if value is None or value == "" or value == "-":
        return None
    try:
        return float(str(value).replace(",", ""))
    except (TypeError, ValueError):
        return None


def normalise_records(
    records: list[ParsedRecord],
    contract: SourceContract,
    variables: dict[str, VariableContract],
    index: CountyIndex,
    *,
    ingestion_run_id: int | None = None,
    raw_artifact_id: int | None = None,
) -> NormalizationResult:
    """Join every parsed record to canonical geography and emit observations.

    One ParsedRecord yields one Observation per contract variable binding
    whose source_field is present.
    """
    result = NormalizationResult()
    bindings = [
        (b.variable_id, b.source_field)
        for b in contract.variables
        if b.variable_id in variables
    ]
    if not bindings:
        raise ValueError(
            f"source {contract.source_id}: no contract variables are registered "
            "in the variable dictionary — register variables before normalising"
        )

    for rec in records:
        join = join_county(index, **rec.geography)
        result.join_results.append(join)

        if not join.authoritative:
            # Fuzzy candidates and no-matches are quarantined for review.
            stage = "normalise"
            reason = (
                "fuzzy_join_candidate" if join.method == MATCH_CANDIDATE_FUZZY else "no_county_match"
            )
            result.quarantined.append(
                QuarantineEntry(
                    stage=stage,
                    reason=reason,
                    record=rec.raw or rec.values,
                    source_record_id=rec.source_record_id,
                    join_candidate=join,
                )
            )
            continue

        if contract.time_grain != "static" and rec.period_start is None:
            result.quarantined.append(
                QuarantineEntry(
                    stage="normalise",
                    reason="unparseable_period",
                    record=rec.raw or rec.values,
                    source_record_id=rec.source_record_id,
                )
            )
            continue

        provenance = build_provenance(
            source_id=contract.source_id,
            source_version=contract.source_version,
            ingestion_run_id=ingestion_run_id,
            raw_artifact_id=raw_artifact_id,
            source_record_id=rec.source_record_id,
            source_row_hash=rec.source_row_hash,
            extra={"join_method": join.method},
        )

        for variable_id, source_field in bindings:
            if source_field not in rec.values:
                continue
            var = variables[variable_id]
            value = _to_float(rec.values[source_field])
            result.observations.append(
                Observation(
                    county_fips=join.county_fips,
                    period_start=rec.period_start,
                    period_end=rec.period_end or rec.period_start,
                    variable_id=variable_id,
                    value_numeric=value,
                    value_text=None if value is not None else (
                        str(rec.values[source_field]) if rec.values[source_field] not in (None, "") else None
                    ),
                    unit=var.unit,
                    source_id=contract.source_id,
                    source_version=contract.source_version,
                    confidence=join.method,
                    provenance_json=provenance,
                    time_grain=var.time_grain,
                )
            )
    return result
