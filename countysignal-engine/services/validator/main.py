"""Validator: periodic data-quality sweeps over the normalised store.

Runs variable-level validation (missingness, unit consistency, freshness)
and duplicate-detection on a schedule, writing results to
audit.validation_results and refreshing registry.source_health freshness.
Source/geography/feature/experiment validation runs inline in their
pipelines; this service is the ongoing watchdog.
"""

from __future__ import annotations

import logging
import time
from datetime import date

import pandas as pd
from sqlalchemy import text

from engine.db import get_engine
from engine.ingestion.sink import DbSink
from engine.validation import CheckResult, ValidationReport, validate_variables

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("cse.validator")

SWEEP_INTERVAL_S = 6 * 3600


def sweep() -> None:
    with get_engine().begin() as conn:
        obs = pd.DataFrame([dict(r._mapping) for r in conn.execute(text(
            """SELECT county_fips, period_start, variable_id, value_numeric, unit, source_id
               FROM norm.county_observations"""))])
        if obs.empty:
            logger.info("norm store empty; nothing to validate")
            return
        sink = DbSink(conn)
        report = validate_variables(obs)

        # duplicate (county, period, variable) within a source version
        dupes = obs[obs.duplicated(
            subset=["county_fips", "period_start", "variable_id", "source_id"], keep=False)]
        report.add(CheckResult(
            "geography", "no_duplicate_county_periods", dupes.empty,
            observed={"duplicates": int(len(dupes))}))

        # freshness per source
        freshness = ValidationReport(subject="freshness")
        for source_id, grp in obs.groupby("source_id"):
            latest = pd.to_datetime(grp["period_start"]).max()
            age_days = (pd.Timestamp(date.today()) - latest).days
            freshness.add(CheckResult(
                "variable", f"freshness:{source_id}", age_days < 400,
                severity="warning",
                observed={"latest_period": str(latest.date()), "age_days": age_days}))
            conn.execute(text(
                """UPDATE registry.source_health SET freshness_days = :age, updated_at = now()
                   WHERE source_id = :s"""), {"age": age_days, "s": source_id})

        sink.record_validation(report, None)
        sink.record_validation(freshness, None)
        logger.info("sweep complete: %d checks, passed=%s",
                    len(report.checks) + len(freshness.checks),
                    report.passed and freshness.passed)


def main() -> None:
    logger.info("validator ready; sweeping every %ss", SWEEP_INTERVAL_S)
    while True:
        try:
            sweep()
        except Exception:  # noqa: BLE001
            logger.exception("validation sweep failed")
        time.sleep(SWEEP_INTERVAL_S)


if __name__ == "__main__":
    main()
