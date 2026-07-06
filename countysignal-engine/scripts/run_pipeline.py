"""Run one source through the ingestion pipeline.

    python -m scripts.run_pipeline --source bls_laus --mode sample
    python -m scripts.run_pipeline --source census_acs --mode full
    python -m scripts.run_pipeline --source fema_nri --mode dry_run
"""

from __future__ import annotations

import argparse
import json

from adapters.base import RunContext
from adapters.registry import build_adapter
from engine.db import get_engine
from engine.ingestion.runner import run_source_pipeline
from engine.ingestion.sink import DbSink
from engine.ingestion.store import get_store


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True)
    parser.add_argument("--mode", default="full",
                        choices=["dry_run", "sample", "full", "incremental"])
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--param", action="append", default=[],
                        help="extra adapter params as key=value (e.g. year=2023)")
    args = parser.parse_args()

    params = dict(p.split("=", 1) for p in args.param)
    adapter = build_adapter(args.source)
    context = RunContext(mode=args.mode, limit=args.limit, params=params)

    with get_engine().begin() as conn:
        result = run_source_pipeline(adapter, DbSink(conn), get_store(), context)

    print(json.dumps({
        "source_id": result.source_id, "run_id": result.run_id,
        "status": result.status, "records_parsed": result.records_parsed,
        "src_rows_loaded": result.src_rows_loaded,
        "observations_loaded": result.observations_loaded,
        "quarantined": result.quarantined,
        "join_match_rate": result.join_match_rate,
        "lifecycle_status": result.lifecycle_status.name,
        **result.detail,
    }, indent=2, default=str))
    return 0 if result.status in ("succeeded", "partial") else 1


if __name__ == "__main__":
    raise SystemExit(main())
