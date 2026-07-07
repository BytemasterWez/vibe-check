"""Server-side anomaly summaries (Phase 7+).

Aggregates anomaly events across contributors and repeat runs: per-cell
overlap counts, repeatable-anomaly candidates, false-positive candidates.
Feeds the anomaly library built by analysis/scripts/build_anomaly_library.py.
"""
