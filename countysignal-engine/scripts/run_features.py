"""Build a feature matrix run from the feature config and normalised store.

    python -m scripts.run_features [--config contracts/features/default_features.yaml]
"""

from __future__ import annotations

import argparse
from pathlib import Path

from engine.contracts import load_feature_config
from engine.db import get_engine
from engine.features.engine import build_feature_matrix, feature_quality
from engine.orchestration import county_attrs, load_observations, persist_feature_run
from engine.validation import validate_features


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", type=Path, default=None)
    args = parser.parse_args()

    config = load_feature_config(args.config)
    definitions = config.expand()

    with get_engine().begin() as conn:
        observations = load_observations(conn, scoring_only=True)
        if observations.empty:
            print("no scoring-eligible observations in norm.* — ingest sources first")
            return 1
        matrix = build_feature_matrix(observations, definitions,
                                      county_attrs=county_attrs(conn))
        n_counties = int(observations["county_fips"].nunique())
        quality = feature_quality(matrix, n_counties)
        report = validate_features(matrix, definitions)
        run_id = persist_feature_run(conn, definitions, matrix, quality,
                                     config={"definitions": len(definitions)})
        from engine.ingestion.sink import DbSink
        DbSink(conn).record_validation(report, None)

    print(f"feature_run_id={run_id} rows={len(matrix)} "
          f"features={matrix['feature_id'].nunique()} validation_passed={report.passed}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
