"""Ingestion runner: orchestrates a source through its full lifecycle.

    fetch → store raw artifact → parse → validate → load src → normalise

Gates enforced here (not in adapters, so they cannot be skipped):
  * a source with no contract cannot run at all (adapters take a contract);
  * raw bytes are stored and hashed BEFORE parsing;
  * failed records go to quarantine, never silently dropped;
  * a source below VALIDATION_PASSING may not write to norm.*;
  * only authoritative join methods enter norm.* (enforced again by a DB
    CHECK constraint); fuzzy candidates land in quarantine.join_candidates;
  * lifecycle status is promoted stepwise based on observed evidence, and
    COUNTY_JOIN_PASSING requires a >= 95% authoritative join rate.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field

from adapters.base import ParsedBatch, RunContext, SourceAdapter
from engine.contracts import SourceStatus, can_write_norm
from engine.ingestion.sink import Sink
from engine.ingestion.store import ArtifactStore
from engine.normalisation.geography import join_quality_report
from engine.normalisation.normalise import QuarantineEntry, normalise_records
from engine.validation import validate_geography

logger = logging.getLogger(__name__)

JOIN_RATE_REQUIRED = 0.95


@dataclass
class PipelineResult:
    source_id: str
    run_id: int
    status: str
    records_parsed: int = 0
    src_rows_loaded: int = 0
    observations_loaded: int = 0
    quarantined: int = 0
    join_match_rate: float | None = None
    validation_passed: bool = False
    lifecycle_status: SourceStatus = SourceStatus.UNVERIFIED
    detail: dict = field(default_factory=dict)


def run_source_pipeline(
    adapter: SourceAdapter,
    sink: Sink,
    store: ArtifactStore,
    run_context: RunContext,
) -> PipelineResult:
    contract = adapter.contract
    sink.upsert_source(contract)
    sink.register_variables(adapter.variables)
    run_id = sink.start_run(contract, run_context.mode, run_context.params)
    result = PipelineResult(source_id=contract.source_id, run_id=run_id, status="running")

    try:
        # 1. fetch + store raw (immutable, hashed) — always before transformation
        artifact = adapter.fetch(run_context)
        stored = store.put(contract.source_id, artifact.filename, artifact.data)
        raw_artifact_id = sink.insert_raw_artifact(
            contract, run_id,
            file_path=stored.key, content_hash=stored.content_hash,
            size_bytes=stored.size_bytes, source_url=artifact.source_url,
            request_params=artifact.request_params, content_type=artifact.content_type,
            record_count_claimed=artifact.record_count_claimed,
            retrieved_at=artifact.retrieved_at,
        )
        status = sink.get_source_status(contract.source_id)
        if status < SourceStatus.SAMPLE_CAPTURED and status != SourceStatus.DISABLED:
            sink.set_source_status(contract.source_id, SourceStatus.SAMPLE_CAPTURED)

        if run_context.mode == "dry_run":
            sink.finish_run(run_id, "succeeded", fetched=0, loaded=0, quarantined=0)
            result.status = "succeeded"
            result.lifecycle_status = sink.get_source_status(contract.source_id)
            return result

        # 2. parse (+ optional sample limit) and detect schema drift
        batch: ParsedBatch = adapter.parse(artifact)
        if run_context.limit:
            batch = ParsedBatch(batch.records[: run_context.limit], batch.observed_fields)
        result.records_parsed = len(batch.records)
        if contract.field_map:
            expected_fields = list(contract.field_map.values())
            if set(batch.observed_fields) != set(expected_fields):
                sink.record_schema_drift(
                    contract.source_id, run_id, expected_fields, batch.observed_fields
                )

        # 3. source-level validation
        report = adapter.validate(batch)
        sink.record_validation(report, run_id)
        if not report.passed:
            # Every failing record set is preserved, not dropped.
            sink.quarantine(
                contract.source_id, run_id,
                [QuarantineEntry(stage="validate", reason="source_validation_failed",
                                 record={"checks": [c.check_name for c in report.checks
                                                    if not c.passed]})],
            )
            sink.finish_run(run_id, "failed", fetched=len(batch.records),
                            error="source validation failed")
            sink.update_source_health(
                contract.source_id, status="validation_failed", latest_period=None,
                join_rate=None, row_count=len(batch.records), failed=True,
            )
            result.status = "failed"
            result.lifecycle_status = sink.get_source_status(contract.source_id)
            return result
        result.validation_passed = True
        status = sink.get_source_status(contract.source_id)
        if SourceStatus.SAMPLE_CAPTURED <= status < SourceStatus.VALIDATION_PASSING:
            sink.set_source_status(contract.source_id, SourceStatus.VALIDATION_PASSING)

        # 4. load src.* (idempotent: dedupe on source_record_id + row hash)
        provenance_cols = {
            "source_id": contract.source_id,
            "source_version": contract.source_version,
            "ingestion_run_id": run_id,
            "raw_artifact_id": raw_artifact_id,
            "retrieved_at": artifact.retrieved_at,
        }
        src_rows = []
        for rec in batch.records:
            for row in adapter.src_rows(rec):
                row.update(provenance_cols)
                row.setdefault("source_record_id", rec.source_record_id)
                row.setdefault("source_row_hash", rec.source_row_hash)
                src_rows.append(row)
        result.src_rows_loaded = sink.insert_src_rows(contract.src_table, src_rows)
        sink.record_row_count(
            contract.source_id, run_id, "src",
            expected=artifact.record_count_claimed, observed=len(src_rows),
        )

        # 5. normalise to county-time observations (gated on lifecycle status)
        status = sink.get_source_status(contract.source_id)
        if not can_write_norm(status):
            sink.finish_run(run_id, "partial", fetched=len(batch.records),
                            loaded=result.src_rows_loaded, quarantined=0,
                            error=f"norm write blocked: source status {status.name}")
            result.status = "partial"
            result.lifecycle_status = status
            return result

        index = sink.county_index()
        norm_result = normalise_records(
            batch.records, contract, adapter.variables, index,
            ingestion_run_id=run_id, raw_artifact_id=raw_artifact_id,
        )
        join_report = join_quality_report(norm_result.join_results)
        sink.record_join_quality(contract.source_id, run_id, join_report)
        geo_report = validate_geography(
            contract,
            [r.method for r in norm_result.join_results],
            [o.county_fips for o in norm_result.observations],
            active_county_count=sink.active_county_count(),
        )
        sink.record_validation(geo_report, run_id)

        result.observations_loaded = sink.insert_observations(norm_result.observations)
        sink.quarantine(contract.source_id, run_id, norm_result.quarantined)
        result.quarantined = len(norm_result.quarantined)
        result.join_match_rate = join_report["match_rate"]
        sink.record_row_count(contract.source_id, run_id, "norm", expected=None,
                              observed=result.observations_loaded)

        # 6. lifecycle promotion on evidence
        if geo_report.passed and join_report["match_rate"] >= JOIN_RATE_REQUIRED:
            status = sink.get_source_status(contract.source_id)
            if status == SourceStatus.VALIDATION_PASSING:
                sink.set_source_status(contract.source_id, SourceStatus.COUNTY_JOIN_PASSING)
            status = sink.get_source_status(contract.source_id)
            if contract.production_allowed and status == SourceStatus.COUNTY_JOIN_PASSING:
                sink.set_source_status(contract.source_id, SourceStatus.PRODUCTION_ALLOWED)

        latest = max(
            (o.period_start for o in norm_result.observations if o.period_start), default=None
        )
        sink.update_source_health(
            contract.source_id, status="healthy",
            latest_period=str(latest) if latest else None,
            join_rate=join_report["match_rate"],
            row_count=len(batch.records), failed=False,
        )
        sink.finish_run(run_id, "succeeded", fetched=len(batch.records),
                        loaded=result.observations_loaded, quarantined=result.quarantined)
        result.status = "succeeded"
        result.lifecycle_status = sink.get_source_status(contract.source_id)
        return result

    except Exception as exc:  # noqa: BLE001 — every failure must be recorded
        logger.exception("pipeline failed for %s", contract.source_id)
        sink.finish_run(run_id, "failed", error=str(exc))
        sink.update_source_health(
            contract.source_id, status="error", latest_period=None,
            join_rate=None, row_count=None, failed=True,
        )
        result.status = "failed"
        result.detail["error"] = str(exc)
        result.lifecycle_status = sink.get_source_status(contract.source_id)
        return result
