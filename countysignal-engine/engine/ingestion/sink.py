"""Persistence sinks for the ingestion runner.

The runner is pure orchestration; everything it writes goes through this
interface. DbSink persists to Postgres; MemorySink backs unit tests and dry
runs, so the whole pipeline is exercisable without a database.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy import text
from sqlalchemy.engine import Connection

from engine.contracts import SourceContract, SourceStatus, VariableContract
from engine.normalisation.geography import CountyIndex
from engine.normalisation.normalise import Observation, QuarantineEntry
from engine.provenance import utcnow
from engine.validation import ValidationReport

_GRAIN_TABLE = {
    "month": "norm.county_month_variables",
    "year": "norm.county_year_variables",
    "static": "norm.county_static_variables",
}


class Sink:
    def upsert_source(self, contract: SourceContract) -> None: ...
    def get_source_status(self, source_id: str) -> SourceStatus: ...
    def set_source_status(self, source_id: str, status: SourceStatus) -> None: ...
    def register_variables(self, variables: dict[str, VariableContract]) -> None: ...
    def start_run(self, contract: SourceContract, mode: str, params: dict) -> int: ...
    def finish_run(self, run_id: int, status: str, *, fetched: int | None = None,
                   loaded: int | None = None, quarantined: int | None = None,
                   error: str | None = None) -> None: ...
    def insert_raw_artifact(self, contract: SourceContract, run_id: int, *,
                            file_path: str, content_hash: str, size_bytes: int,
                            source_url: str, request_params: dict,
                            content_type: str, record_count_claimed: int | None,
                            retrieved_at) -> int: ...
    def insert_src_rows(self, table: str, rows: list[dict]) -> int: ...
    def insert_observations(self, observations: list[Observation]) -> int: ...
    def quarantine(self, source_id: str, run_id: int | None,
                   entries: list[QuarantineEntry]) -> None: ...
    def record_validation(self, report: ValidationReport, run_id: int | None) -> None: ...
    def record_join_quality(self, source_id: str, run_id: int | None, report: dict) -> None: ...
    def record_schema_drift(self, source_id: str, run_id: int | None,
                            expected: list[str], observed: list[str]) -> None: ...
    def record_row_count(self, source_id: str, run_id: int | None, stage: str,
                         expected: int | None, observed: int) -> None: ...
    def update_source_health(self, source_id: str, *, status: str,
                             latest_period: str | None, join_rate: float | None,
                             row_count: int | None, failed: bool) -> None: ...
    def county_index(self) -> CountyIndex: ...
    def active_county_count(self) -> int: ...


# ---------------------------------------------------------------------------


@dataclass
class MemorySink(Sink):
    """In-memory sink for unit tests and dry runs."""

    counties: list[dict] = field(default_factory=list)
    aliases: list[dict] = field(default_factory=list)
    crosswalks: list[dict] = field(default_factory=list)

    sources: dict[str, dict] = field(default_factory=dict)
    statuses: dict[str, SourceStatus] = field(default_factory=dict)
    variables: dict[str, VariableContract] = field(default_factory=dict)
    runs: list[dict] = field(default_factory=list)
    raw_artifacts: list[dict] = field(default_factory=list)
    src_rows: dict[str, list[dict]] = field(default_factory=dict)
    observations: list[Observation] = field(default_factory=list)
    quarantined: list[dict] = field(default_factory=list)
    validations: list[dict] = field(default_factory=list)
    join_quality: list[dict] = field(default_factory=list)
    schema_drift: list[dict] = field(default_factory=list)
    row_counts: list[dict] = field(default_factory=list)
    health: dict[str, dict] = field(default_factory=dict)

    def upsert_source(self, contract):
        self.sources[contract.source_id] = json.loads(contract.model_dump_json())
        if contract.status_enum == SourceStatus.DISABLED:
            self.statuses[contract.source_id] = SourceStatus.DISABLED
        else:
            self.statuses.setdefault(contract.source_id, contract.status_enum)

    def get_source_status(self, source_id):
        return self.statuses.get(source_id, SourceStatus.UNVERIFIED)

    def set_source_status(self, source_id, status):
        self.statuses[source_id] = status

    def register_variables(self, variables):
        self.variables.update(variables)

    def start_run(self, contract, mode, params):
        self.runs.append(
            {"source_id": contract.source_id, "mode": mode, "params": params,
             "status": "running", "started_at": utcnow()}
        )
        return len(self.runs)

    def finish_run(self, run_id, status, *, fetched=None, loaded=None,
                   quarantined=None, error=None):
        run = self.runs[run_id - 1]
        run.update({"status": status, "records_fetched": fetched, "records_loaded": loaded,
                    "records_quarantined": quarantined, "error": error,
                    "finished_at": utcnow()})

    def insert_raw_artifact(self, contract, run_id, **kw):
        for a in self.raw_artifacts:  # dedupe on (source_id, content_hash)
            if a["source_id"] == contract.source_id and a["content_hash"] == kw["content_hash"]:
                return a["raw_artifact_id"]
        artifact = {"raw_artifact_id": len(self.raw_artifacts) + 1,
                    "source_id": contract.source_id, "ingestion_run_id": run_id, **kw}
        self.raw_artifacts.append(artifact)
        return artifact["raw_artifact_id"]

    def insert_src_rows(self, table, rows):
        existing = self.src_rows.setdefault(table, [])
        keys = {(r["source_id"], r["source_record_id"], r["source_row_hash"]) for r in existing}
        loaded = 0
        for r in rows:
            k = (r["source_id"], r["source_record_id"], r["source_row_hash"])
            if k not in keys:
                existing.append(r)
                keys.add(k)
                loaded += 1
        return loaded

    def insert_observations(self, observations):
        keys = {
            (o.county_fips, o.period_start, o.variable_id, o.source_id, o.source_version)
            for o in self.observations
        }
        loaded = 0
        for o in observations:
            k = (o.county_fips, o.period_start, o.variable_id, o.source_id, o.source_version)
            if k not in keys:
                self.observations.append(o)
                keys.add(k)
                loaded += 1
        return loaded

    def quarantine(self, source_id, run_id, entries):
        for e in entries:
            self.quarantined.append(
                {"source_id": source_id, "ingestion_run_id": run_id, "stage": e.stage,
                 "reason": e.reason, "record": e.record,
                 "source_record_id": e.source_record_id,
                 "join_candidate": e.join_candidate.__dict__ if e.join_candidate else None}
            )

    def record_validation(self, report, run_id):
        for c in report.checks:
            self.validations.append({"subject": report.subject, "run_id": run_id, **c.as_dict()})

    def record_join_quality(self, source_id, run_id, report):
        self.join_quality.append({"source_id": source_id, "run_id": run_id, **report})

    def record_schema_drift(self, source_id, run_id, expected, observed):
        self.schema_drift.append(
            {"source_id": source_id, "run_id": run_id,
             "expected": expected, "observed": observed,
             "added": sorted(set(observed) - set(expected)),
             "missing": sorted(set(expected) - set(observed))}
        )

    def record_row_count(self, source_id, run_id, stage, expected, observed):
        passed = expected is None or expected == observed
        self.row_counts.append({"source_id": source_id, "run_id": run_id, "stage": stage,
                                "expected": expected, "observed": observed, "passed": passed})

    def update_source_health(self, source_id, *, status, latest_period, join_rate,
                             row_count, failed):
        self.health[source_id] = {
            "status": status, "latest_period": latest_period,
            "county_join_rate": join_rate, "row_count_latest": row_count,
            "failed": failed, "updated_at": utcnow(),
        }

    def county_index(self):
        return CountyIndex.build(self.counties, self.aliases, self.crosswalks)

    def active_county_count(self):
        return len(self.counties)


# ---------------------------------------------------------------------------


class DbSink(Sink):
    """Postgres persistence for the full pipeline."""

    def __init__(self, conn: Connection):
        self.conn = conn

    def _exec(self, sql: str, **params):
        return self.conn.execute(text(sql), params)

    def upsert_source(self, contract: SourceContract) -> None:
        self._exec(
            """
            INSERT INTO registry.sources (source_id, name, owner, category, access_method,
                access_url, licence_status, scraping_allowed, api_key_required,
                update_frequency, geography_level, time_grain, canonical_join_key,
                raw_format, status, contract_yaml, contract_hash, production_allowed)
            VALUES (:source_id, :name, :owner, :category, :access_method, :access_url,
                    :licence_status, :scraping_allowed, :api_key_required,
                    :update_frequency, :geography_level, :time_grain, :canonical_join_key,
                    :raw_format, :status, :contract_yaml, :contract_hash, :production_allowed)
            ON CONFLICT (source_id) DO UPDATE SET
                name = EXCLUDED.name, contract_yaml = EXCLUDED.contract_yaml,
                contract_hash = EXCLUDED.contract_hash,
                -- lifecycle status is promoted by evidence, never by re-reading
                -- the contract; only an explicit DISABLED in the contract wins
                status = CASE WHEN EXCLUDED.status = 'DISABLED'
                              THEN 'DISABLED' ELSE registry.sources.status END,
                production_allowed = EXCLUDED.production_allowed, updated_at = now()
            """,
            source_id=contract.source_id, name=contract.name, owner=contract.owner,
            category=contract.category, access_method=contract.access_method,
            access_url=contract.access_url, licence_status=contract.licence_status,
            scraping_allowed=contract.scraping_allowed,
            api_key_required=contract.api_key_required,
            update_frequency=contract.update_frequency,
            geography_level=contract.geography_level, time_grain=contract.time_grain,
            canonical_join_key=contract.canonical_join_key, raw_format=contract.raw_format,
            status=contract.status, contract_yaml=contract.raw_yaml,
            contract_hash=contract.contract_hash,
            production_allowed=contract.production_allowed,
        )
        self._exec(
            """
            INSERT INTO registry.source_versions (source_id, version_label, contract_hash)
            VALUES (:source_id, :version_label, :contract_hash)
            ON CONFLICT (source_id, version_label) DO NOTHING
            """,
            source_id=contract.source_id, version_label=contract.source_version,
            contract_hash=contract.contract_hash,
        )
        self._exec(
            """
            INSERT INTO registry.licence_terms (source_id, licence_status, terms_url,
                attribution_text, scraping_allowed)
            VALUES (:source_id, :licence_status, :terms_url, :attribution, :scraping_allowed)
            ON CONFLICT (source_id, licence_status) DO NOTHING
            """,
            source_id=contract.source_id, licence_status=contract.licence_status,
            terms_url=contract.access_url, attribution=contract.attribution,
            scraping_allowed=contract.scraping_allowed,
        )

    def get_source_status(self, source_id: str) -> SourceStatus:
        row = self._exec(
            "SELECT status FROM registry.sources WHERE source_id = :s", s=source_id
        ).fetchone()
        return SourceStatus[row[0]] if row else SourceStatus.UNVERIFIED

    def set_source_status(self, source_id: str, status: SourceStatus) -> None:
        self._exec(
            "UPDATE registry.sources SET status = :st, updated_at = now() WHERE source_id = :s",
            st=status.name, s=source_id,
        )

    def register_variables(self, variables: dict[str, VariableContract]) -> None:
        for v in variables.values():
            self._exec(
                """
                INSERT INTO norm.variable_dictionary (variable_id, source_id, name,
                    description, unit, time_grain, geography_grain, directionality,
                    higher_is_good, transform_allowed, source_field, normalisation_method,
                    missing_value_policy)
                VALUES (:variable_id, :source_id, :name, :description, :unit, :time_grain,
                        :geography_grain, :directionality, :higher_is_good,
                        :transform_allowed, :source_field, :normalisation_method,
                        :missing_value_policy)
                ON CONFLICT (variable_id) DO UPDATE SET
                    name = EXCLUDED.name, description = EXCLUDED.description,
                    unit = EXCLUDED.unit, updated_at = now()
                """,
                **v.model_dump(exclude={"first_available_period", "latest_available_period"}),
            )

    def start_run(self, contract, mode, params) -> int:
        row = self._exec(
            """
            INSERT INTO registry.ingestion_runs (source_id, source_version, mode, run_params)
            VALUES (:source_id, :source_version, :mode, :params)
            RETURNING ingestion_run_id
            """,
            source_id=contract.source_id, source_version=contract.source_version,
            mode=mode, params=json.dumps(params, default=str),
        ).fetchone()
        return int(row[0])

    def finish_run(self, run_id, status, *, fetched=None, loaded=None,
                   quarantined=None, error=None) -> None:
        self._exec(
            """
            UPDATE registry.ingestion_runs
            SET status = :status, finished_at = now(), records_fetched = :fetched,
                records_loaded = :loaded, records_quarantined = :quarantined, error = :error
            WHERE ingestion_run_id = :run_id
            """,
            status=status, fetched=fetched, loaded=loaded,
            quarantined=quarantined, error=error, run_id=run_id,
        )

    def insert_raw_artifact(self, contract, run_id, *, file_path, content_hash,
                            size_bytes, source_url, request_params, content_type,
                            record_count_claimed, retrieved_at) -> int:
        row = self._exec(
            """
            INSERT INTO raw.files (source_id, source_version, ingestion_run_id,
                retrieved_at, source_url, request_params, file_path, content_type,
                content_hash, size_bytes, record_count_claimed, licence_status)
            VALUES (:source_id, :source_version, :run_id, :retrieved_at, :source_url,
                    :request_params, :file_path, :content_type, :content_hash,
                    :size_bytes, :record_count_claimed, :licence_status)
            ON CONFLICT (source_id, content_hash) DO UPDATE SET record_count_claimed =
                COALESCE(raw.files.record_count_claimed, EXCLUDED.record_count_claimed)
            RETURNING raw_artifact_id
            """,
            source_id=contract.source_id, source_version=contract.source_version,
            run_id=run_id, retrieved_at=retrieved_at, source_url=source_url,
            request_params=json.dumps(request_params, default=str),
            file_path=file_path, content_type=content_type, content_hash=content_hash,
            size_bytes=size_bytes, record_count_claimed=record_count_claimed,
            licence_status=contract.licence_status,
        ).fetchone()
        return int(row[0])

    def _count(self, table: str) -> int:
        return int(self._exec(f"SELECT count(*) FROM {table}").fetchone()[0])

    def insert_src_rows(self, table: str, rows: list[dict]) -> int:
        if not rows:
            return 0
        if not table.startswith("src.") or not table.replace("src.", "").isidentifier():
            raise ValueError(f"invalid src table name: {table}")
        cols = list(rows[0].keys())
        col_sql = ", ".join(cols)
        val_sql = ", ".join(f":{c}" for c in cols)
        sql = text(
            f"INSERT INTO {table} ({col_sql}) VALUES ({val_sql}) "
            "ON CONFLICT (source_id, source_record_id, source_row_hash) DO NOTHING"
        )
        # Chunked executemany: required for full-history backfills (millions
        # of rows). ON CONFLICT rowcounts are unreliable under executemany,
        # so loaded counts come from a before/after count delta.
        before = self._count(table)
        for i in range(0, len(rows), 10_000):
            self.conn.execute(sql, rows[i:i + 10_000])
        return self._count(table) - before

    def insert_observations(self, observations: list[Observation]) -> int:
        by_grain: dict[str, list[dict]] = {}
        for o in observations:
            if o.time_grain == "static":
                row = {"county_fips": o.county_fips, "variable_id": o.variable_id,
                       "as_of": o.period_start}
            else:
                row = {"county_fips": o.county_fips, "period_start": o.period_start,
                       "period_end": o.period_end, "variable_id": o.variable_id}
            row.update(value_numeric=o.value_numeric, value_text=o.value_text,
                       unit=o.unit, source_id=o.source_id,
                       source_version=o.source_version, confidence=o.confidence,
                       provenance=json.dumps(o.provenance_json, default=str))
            by_grain.setdefault(o.time_grain, []).append(row)

        loaded = 0
        for grain, rows in by_grain.items():
            table = _GRAIN_TABLE[grain]
            if grain == "static":
                sql = text(
                    f"""INSERT INTO {table} (county_fips, variable_id, as_of, value_numeric,
                            value_text, unit, source_id, source_version, confidence, provenance_json)
                        VALUES (:county_fips, :variable_id, :as_of, :value_numeric, :value_text,
                                :unit, :source_id, :source_version, :confidence, :provenance)
                        ON CONFLICT (county_fips, variable_id, as_of, source_id, source_version)
                        DO NOTHING""")
            else:
                sql = text(
                    f"""INSERT INTO {table} (county_fips, period_start, period_end, variable_id,
                            value_numeric, value_text, unit, source_id, source_version,
                            confidence, provenance_json)
                        VALUES (:county_fips, :period_start, :period_end, :variable_id,
                                :value_numeric, :value_text, :unit, :source_id,
                                :source_version, :confidence, :provenance)
                        ON CONFLICT (county_fips, period_start, variable_id, source_id, source_version)
                        DO NOTHING""")
            before = self._count(table)
            for i in range(0, len(rows), 10_000):
                self.conn.execute(sql, rows[i:i + 10_000])
            loaded += self._count(table) - before
        return loaded

    def quarantine(self, source_id, run_id, entries) -> None:
        for e in entries:
            if e.join_candidate is not None and e.reason == "fuzzy_join_candidate":
                self._exec(
                    """
                    INSERT INTO quarantine.join_candidates (source_id, ingestion_run_id,
                        raw_geography, candidate_fips, candidate_score, method, record)
                    VALUES (:source_id, :run_id, :geo, :fips, :score, :method, :record)
                    """,
                    source_id=source_id, run_id=run_id,
                    geo=json.dumps(e.join_candidate.input_geography, default=str),
                    fips=e.join_candidate.county_fips,
                    score=e.join_candidate.candidate_score,
                    method=e.join_candidate.method,
                    record=json.dumps(e.record, default=str),
                )
            self._exec(
                """
                INSERT INTO quarantine.records (source_id, ingestion_run_id, stage,
                    reason, record, source_record_id)
                VALUES (:source_id, :run_id, :stage, :reason, :record, :source_record_id)
                """,
                source_id=source_id, run_id=run_id, stage=e.stage, reason=e.reason,
                record=json.dumps(e.record, default=str),
                source_record_id=e.source_record_id,
            )

    def record_validation(self, report: ValidationReport, run_id) -> None:
        for c in report.checks:
            self._exec(
                """
                INSERT INTO audit.validation_results (level, subject, check_name, passed,
                    severity, observed, expected, ingestion_run_id)
                VALUES (:level, :subject, :check_name, :passed, :severity,
                        :observed, :expected, :run_id)
                """,
                level=c.level, subject=report.subject, check_name=c.check_name,
                passed=c.passed, severity=c.severity,
                observed=json.dumps(c.observed, default=str),
                expected=json.dumps(c.expected, default=str), run_id=run_id,
            )

    def record_join_quality(self, source_id, run_id, report) -> None:
        self._exec(
            """
            INSERT INTO audit.join_quality (source_id, ingestion_run_id, total_records,
                matched, match_rate, by_confidence, unmatched_sample)
            VALUES (:source_id, :run_id, :total, :matched, :rate, :by_conf, :sample)
            """,
            source_id=source_id, run_id=run_id, total=report["total_records"],
            matched=report["matched"], rate=report["match_rate"],
            by_conf=json.dumps(report["by_confidence"]),
            sample=json.dumps(report["unmatched_sample"], default=str),
        )

    def record_schema_drift(self, source_id, run_id, expected, observed) -> None:
        self._exec(
            """
            INSERT INTO audit.schema_drift (source_id, ingestion_run_id, expected_fields,
                observed_fields, added_fields, missing_fields)
            VALUES (:source_id, :run_id, :expected, :observed, :added, :missing)
            """,
            source_id=source_id, run_id=run_id,
            expected=json.dumps(sorted(expected)), observed=json.dumps(sorted(observed)),
            added=json.dumps(sorted(set(observed) - set(expected))),
            missing=json.dumps(sorted(set(expected) - set(observed))),
        )

    def record_row_count(self, source_id, run_id, stage, expected, observed) -> None:
        self._exec(
            """
            INSERT INTO audit.row_count_checks (source_id, ingestion_run_id, stage,
                expected, observed, passed)
            VALUES (:source_id, :run_id, :stage, :expected, :observed, :passed)
            """,
            source_id=source_id, run_id=run_id, stage=stage, expected=expected,
            observed=observed, passed=expected is None or expected == observed,
        )

    def update_source_health(self, source_id, *, status, latest_period, join_rate,
                             row_count, failed) -> None:
        self._exec(
            """
            INSERT INTO registry.source_health (source_id, status, last_successful_run,
                last_failed_run, consecutive_failures, latest_period, county_join_rate,
                row_count_latest)
            VALUES (:source_id, :status,
                    CASE WHEN :failed THEN NULL ELSE now() END,
                    CASE WHEN :failed THEN now() ELSE NULL END,
                    CASE WHEN :failed THEN 1 ELSE 0 END,
                    :latest_period, :join_rate, :row_count)
            ON CONFLICT (source_id) DO UPDATE SET
                status = EXCLUDED.status,
                last_successful_run = COALESCE(EXCLUDED.last_successful_run,
                                               registry.source_health.last_successful_run),
                last_failed_run = COALESCE(EXCLUDED.last_failed_run,
                                           registry.source_health.last_failed_run),
                consecutive_failures = CASE WHEN :failed
                    THEN registry.source_health.consecutive_failures + 1 ELSE 0 END,
                latest_period = COALESCE(EXCLUDED.latest_period,
                                         registry.source_health.latest_period),
                county_join_rate = COALESCE(EXCLUDED.county_join_rate,
                                            registry.source_health.county_join_rate),
                row_count_latest = COALESCE(EXCLUDED.row_count_latest,
                                            registry.source_health.row_count_latest),
                updated_at = now()
            """,
            source_id=source_id, status=status, failed=failed,
            latest_period=latest_period, join_rate=join_rate, row_count=row_count,
        )

    def county_index(self) -> CountyIndex:
        counties = [dict(r._mapping) for r in self._exec(
            """SELECT county_fips, state_fips, state_abbr, state_name, county_name,
                      county_equivalent_name FROM ref.counties WHERE is_active"""
        )]
        aliases = [dict(r._mapping) for r in self._exec(
            "SELECT county_fips, alias_name FROM ref.geography_aliases"
        )]
        crosswalks = [dict(r._mapping) for r in self._exec(
            "SELECT old_fips, new_fips FROM ref.fips_crosswalks"
        )]
        return CountyIndex.build(counties, aliases, crosswalks)

    def active_county_count(self) -> int:
        return int(self._exec(
            "SELECT count(*) FROM ref.counties WHERE is_active"
        ).fetchone()[0])
