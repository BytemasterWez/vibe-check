"""Evaluate a declared event over the latest feature run.

    python -m scripts.run_event --event unemployment_spike_2pp_12m
"""

from __future__ import annotations

import argparse

from engine.contracts import load_event_contracts
from engine.db import get_engine
from engine.events.engine import build_case_control_set, detect_occurrences
from engine.orchestration import (
    latest_feature_run_id,
    load_feature_matrix,
    load_observations,
    persist_event,
)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--event", required=True)
    parser.add_argument("--feature-run", type=int, default=None)
    args = parser.parse_args()

    events = load_event_contracts()
    if args.event not in events:
        raise SystemExit(f"no event contract '{args.event}' under contracts/events/")
    event = events[args.event]

    with get_engine().begin() as conn:
        run_id = args.feature_run or latest_feature_run_id(conn)
        matrix = load_feature_matrix(conn, run_id)
        observations = load_observations(conn, scoring_only=True)
        occurrences = detect_occurrences(event, matrix, observations)
        case_control = build_case_control_set(event, occurrences, matrix)
        set_id = persist_event(conn, event, occurrences, case_control, run_id)

    diag = case_control.diagnostics()
    print(f"event={event.event_id} feature_run={run_id} occurrences={len(occurrences)} "
          f"cases={diag['case_count']} controls={diag['control_count']} "
          f"excluded={diag['excluded_count']} case_control_set={set_id}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
