"""Worker: executes queued jobs from Redis (list 'cse:jobs').

Job payloads are JSON:
    {"type": "ingest",     "source_id": "bls_laus", "mode": "full", "params": {}}
    {"type": "features"}
    {"type": "event",      "event_id": "unemployment_spike_2pp_12m"}
    {"type": "experiment", "event_id": "unemployment_spike_2pp_12m"}
    {"type": "scoring",    "recipe_id": "labour_shock_monitor"}

Every job execution is recorded in audit.jobs; failures land in audit.errors
and never kill the worker loop.
"""

from __future__ import annotations

import json
import logging
import traceback

import redis
from sqlalchemy import text

from engine.config import get_settings
from engine.db import get_engine

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("cse.worker")

QUEUE = "cse:jobs"


def _run_job(job: dict) -> None:
    job_type = job.get("type")
    if job_type == "ingest":
        from adapters.base import RunContext
        from adapters.registry import build_adapter
        from engine.ingestion.runner import run_source_pipeline
        from engine.ingestion.sink import DbSink
        from engine.ingestion.store import get_store

        adapter = build_adapter(job["source_id"])
        ctx = RunContext(mode=job.get("mode", "full"), params=job.get("params", {}))
        with get_engine().begin() as conn:
            result = run_source_pipeline(adapter, DbSink(conn), get_store(), ctx)
        logger.info("ingest %s -> %s", job["source_id"], result.status)
    elif job_type == "features":
        import scripts.run_features as rf
        import sys
        sys.argv = ["run_features"]
        rf.main()
    elif job_type == "event":
        import sys

        import scripts.run_event as re_
        sys.argv = ["run_event", "--event", job["event_id"]]
        re_.main()
    elif job_type == "experiment":
        import sys

        import scripts.run_experiment as rx
        sys.argv = ["run_experiment", "--event", job["event_id"]]
        rx.main()
    elif job_type == "scoring":
        import sys

        import scripts.run_scoring as rs
        sys.argv = ["run_scoring", "--recipe", job["recipe_id"]]
        rs.main()
    else:
        raise ValueError(f"unknown job type: {job_type}")


def _audit(status: str, job: dict, error: str | None = None) -> None:
    try:
        with get_engine().begin() as conn:
            conn.execute(text(
                """INSERT INTO audit.jobs (job_type, subject, status, finished_at, detail)
                   VALUES (:t, :s, :st, now(), :d)"""),
                {"t": job.get("type", "unknown"),
                 "s": job.get("source_id") or job.get("event_id") or job.get("recipe_id"),
                 "st": status, "d": json.dumps(job, default=str)})
            if error:
                conn.execute(text(
                    """INSERT INTO audit.errors (component, subject, error_type, message, context)
                       VALUES ('worker', :s, 'job_failure', :m, :c)"""),
                    {"s": job.get("type"), "m": error[:4000],
                     "c": json.dumps(job, default=str)})
    except Exception:  # noqa: BLE001
        logger.exception("audit write failed")


def main() -> None:
    settings = get_settings()
    r = redis.from_url(settings.redis_url)
    logger.info("worker ready; waiting on %s", QUEUE)
    while True:
        _, payload = r.blpop(QUEUE)   # blocks
        try:
            job = json.loads(payload)
        except json.JSONDecodeError:
            logger.error("unparseable job payload: %r", payload[:200])
            continue
        logger.info("job start: %s", job)
        try:
            _run_job(job)
            _audit("succeeded", job)
        except Exception as exc:  # noqa: BLE001 — worker must survive job failures
            logger.exception("job failed")
            _audit("failed", job, error=f"{exc}\n{traceback.format_exc()}")


if __name__ == "__main__":
    main()
