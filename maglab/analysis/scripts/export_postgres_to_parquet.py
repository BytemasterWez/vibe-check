#!/usr/bin/env python3
"""Export MagLab Postgres tables straight to Parquet (Phase 9).

Planned behaviour: connect to Postgres/PostGIS, stream sensor_samples,
anomaly_events, surveys, survey_runs and survey_markers into partitioned
Parquet files under data/exports/ for downstream DuckDB / pandas work.
"""

import argparse
import sys


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database-url", required=False, help="Postgres URL")
    parser.add_argument("--output-dir", default="data/exports")
    parser.parse_args()

    print("Phase 9: implemented after backend sync (Phase 7) is live.", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
