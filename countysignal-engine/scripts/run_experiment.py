"""Run a case/control scoring experiment for an event.

    python -m scripts.run_experiment --event unemployment_spike_2pp_12m
"""

from __future__ import annotations

import argparse
import json

from engine.contracts import load_event_contracts
from engine.db import get_engine
from engine.events.engine import build_case_control_set, detect_occurrences
from engine.experiments.engine import run_experiment
from engine.ingestion.sink import DbSink
from engine.orchestration import (
    latest_feature_run_id,
    load_feature_matrix,
    load_observations,
    persist_experiment,
)
from engine.validation import validate_experiment


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--event", required=True)
    parser.add_argument("--feature-run", type=int, default=None)
    parser.add_argument("--horizon", type=int, default=6,
                        help="prediction horizon in months (features precede labels)")
    args = parser.parse_args()

    event = load_event_contracts()[args.event]

    with get_engine().begin() as conn:
        run_id = args.feature_run or latest_feature_run_id(conn)
        matrix = load_feature_matrix(conn, run_id)
        observations = load_observations(conn, scoring_only=True)
        occurrences = detect_occurrences(event, matrix, observations)
        case_control = build_case_control_set(event, occurrences, matrix)
        result = run_experiment(event, case_control, matrix,
                                prediction_horizon_months=args.horizon)
        report = validate_experiment(result)
        experiment_id, model_id = persist_experiment(conn, result, run_id)
        DbSink(conn).record_validation(report, None)

    best = result.best_model
    print(json.dumps({
        "experiment_id": experiment_id, "event_id": result.event_id,
        "cases": result.case_count, "controls": result.control_count,
        "train_period": result.train_period, "test_period": result.test_period,
        "best_model": best.model_type,
        "metrics": best.metrics,
        "baselines": {m.model_type: m.metrics for m in result.models if m.is_baseline},
        "top_variables": [r["feature_id"] for r in result.top_variables[:10]],
        "validation_passed": report.passed,
    }, indent=2, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
