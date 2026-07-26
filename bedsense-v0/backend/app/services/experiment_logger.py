"""Experiment session result computation (spec §20).

Compares expected events against events actually recorded during a session
and produces the per-test result block (detected yes/no, detection delay,
false positives/negatives, average signal quality).
"""
from datetime import datetime

# Event types a scenario is *expected* to produce en route to its target
# event; anything else recorded during the session counts as a false positive.
SCENARIO_EXPECTED_SUPPORTING: dict[str, set[str]] = {
    "empty_bed": {"bed_empty"},
    "person_enters_bed": {"bed_entry", "movement_detected", "stillness_detected",
                          "breathing_like_detected"},
    "person_still": {"stillness_detected", "breathing_like_detected"},
    "breathing_like_motion": {"stillness_detected", "breathing_like_detected"},
    "person_moving": {"movement_detected", "stillness_detected"},
    "bed_exit": {"possible_bed_exit", "bed_exit", "movement_detected",
                 "breathing_like_detected", "stillness_detected", "bed_empty"},
    "restless_night": {"movement_detected", "stillness_detected",
                       "breathing_like_detected"},
    "mixed_sequence": {"bed_entry", "movement_detected", "stillness_detected",
                       "breathing_like_detected", "possible_bed_exit", "bed_exit",
                       "bed_empty"},
    "csv_replay": set(),
    "manual_test": set(),
}

ALWAYS_ALLOWED = {"manual_note", "test_marker", "signal_quality_warning"}

# Default expected events per scenario (spec §11) used when the operator
# doesn't declare their own (also applied to auto-created demo sessions).
DEFAULT_EXPECTED: dict[str, list[str]] = {
    "empty_bed": [],
    "person_enters_bed": ["bed_entry"],
    "person_still": ["breathing_like_detected"],
    "breathing_like_motion": ["breathing_like_detected"],
    "person_moving": ["movement_detected"],
    "bed_exit": ["possible_bed_exit", "bed_exit"],
    "restless_night": ["movement_detected", "stillness_detected"],
    "mixed_sequence": ["bed_entry", "movement_detected", "bed_exit"],
    "csv_replay": [],
    "manual_test": [],
}


def compute_results(
    scenario: str,
    expected_events: list[str],
    actual_events: list[dict],
    started_at: datetime,
    quality_scores: list[float] | None = None,
    unscoped_events_count: int = 0,
) -> dict:
    """Build the actual_results block for an experiment session.

    actual_events: [{"event_type": str, "timestamp_utc": datetime}, ...]
    """
    expected = list(expected_events or [])
    seen_types = [e["event_type"] for e in actual_events]
    supporting = SCENARIO_EXPECTED_SUPPORTING.get(scenario, set()) | set(expected) | ALWAYS_ALLOWED

    per_expected = []
    false_negatives = 0
    for exp in expected:
        matches = [e for e in actual_events if e["event_type"] == exp]
        detected = bool(matches)
        delay = None
        if detected:
            first = min(m["timestamp_utc"] for m in matches)
            delay = round((first - started_at).total_seconds(), 1)
        else:
            false_negatives += 1
        per_expected.append(
            {
                "expected_event": exp,
                "detected": detected,
                "detection_delay_seconds": delay,
                "occurrences": len(matches),
            }
        )

    false_positives = [t for t in seen_types if t not in supporting]

    avg_quality = (
        round(sum(quality_scores) / len(quality_scores), 3) if quality_scores else None
    )

    return {
        "expected": per_expected,
        "false_positive_count": len(false_positives),
        "false_positive_types": sorted(set(false_positives)),
        "false_negative_count": false_negatives,
        "total_events_recorded": len(actual_events),
        "unscoped_events_count": unscoped_events_count,
        "signal_quality_average": avg_quality,
        "all_expected_detected": false_negatives == 0 and bool(expected),
    }


def suggest_pass_fail(results: dict) -> str:
    """Deterministic suggestion only — the operator makes the final call."""
    if not results.get("expected"):
        return "not_assessed"
    if results["false_negative_count"] == 0 and results["false_positive_count"] == 0:
        return "pass"
    if results["all_expected_detected"]:
        return "partial"
    return "fail"


def finalize_experiment(db, session) -> None:
    """End a session and compute its results block.

    Shared by the /experiments/{id}/stop route and the worker's auto-created
    demo sessions. Idempotent on ended_at (keeps the first end time).
    """
    from datetime import timezone

    from sqlalchemy import func, select

    from ..models import BedState, Event

    if session.ended_at is None:
        session.ended_at = datetime.now(timezone.utc)

    events = db.execute(
        select(Event).where(Event.session_id == session.id).order_by(Event.timestamp_utc)
    ).scalars().all()

    # Average signal quality from the per-sensor quality scores fused into
    # each bed state (not the fusion confidence — that is a separate measure).
    quality_scores: list[float] = []
    for state in db.execute(
        select(BedState).where(BedState.session_id == session.id)
    ).scalars().all():
        src = state.source_summary or {}
        sensor_qs = [src.get("pressure_quality"), src.get("radar_quality")]
        sensor_qs = [q for q in sensor_qs if q is not None]
        if sensor_qs:
            quality_scores.append(sum(sensor_qs) / len(sensor_qs))

    # With session enforcement this should always be 0; reported so the
    # evidence pack can prove it.
    unscoped = db.execute(
        select(func.count()).select_from(Event).where(
            Event.session_id.is_(None),
            Event.timestamp_utc >= session.started_at,
            Event.timestamp_utc <= session.ended_at,
        )
    ).scalar_one()

    results = compute_results(
        session.scenario,
        session.expected_events or [],
        [{"event_type": e.event_type, "timestamp_utc": e.timestamp_utc} for e in events],
        session.started_at,
        quality_scores,
        unscoped_events_count=int(unscoped),
    )
    results["suggested_pass_fail"] = suggest_pass_fail(results)
    session.actual_results = results
