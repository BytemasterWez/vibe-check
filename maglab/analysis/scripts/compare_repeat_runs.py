#!/usr/bin/env python3
"""Offline repeatability comparison across survey runs (Phase 9).

Planned behaviour: mirror the iOS RepeatabilityAnalyzer (Phase 6) on the
aggregated dataset — grid samples into cells, compare high-anomaly cells
across runs, compute overlap, peak drift, direction bias and a
repeatability score with decision:
high_repeatability | medium_repeatability | low_repeatability |
insufficient_data.
"""

import argparse
import sys


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("run_ids", nargs="*", help="Two or three run UUIDs to compare")
    parser.add_argument("--duckdb", default="data/maglab.duckdb")
    parser.add_argument("--cell-size-m", type=float, default=5.0)
    parser.parse_args()

    print("Phase 9: implemented after repeatability (Phase 6) ships on iOS.", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
