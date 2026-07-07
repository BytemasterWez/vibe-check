#!/usr/bin/env python3
"""Pull all MagLab backend data into a local DuckDB file (Phase 9).

Planned behaviour:
1. Connect to the backend admin API (or directly to Postgres via
   --database-url) using the admin token.
2. Download surveys, runs, sensor samples, markers and anomaly events.
3. Create analysis-friendly tables in data/maglab.duckdb.
4. Optionally export Parquet copies alongside.

Target outputs:
    data/maglab.duckdb
    data/exports/sensor_samples.parquet
    data/exports/anomaly_events.parquet
    data/exports/surveys.csv
    data/exports/anomalies.geojson
"""

import argparse
import sys


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--backend-url", help="MagLab backend base URL")
    parser.add_argument("--admin-token", help="Admin API token")
    parser.add_argument("--database-url", help="Direct Postgres URL (bypasses the API)")
    parser.add_argument("--output", default="data/maglab.duckdb")
    parser.add_argument("--parquet", action="store_true", help="Also export Parquet files")
    parser.parse_args()

    print("Phase 9: implemented after backend sync (Phase 7) is live.", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
