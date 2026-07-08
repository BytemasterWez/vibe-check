"""Event detector tests (spec §14)."""
from datetime import datetime, timedelta, timezone

from app.services.event_detector import EventDetector

T0 = datetime(2026, 7, 8, 12, 0, 0, tzinfo=timezone.utc)


def state(**overrides) -> dict:
    base = {
        "timestamp_utc": T0,
        "occupied": True,
        "movement_state": "still",
        "breathing_like_detected": None,
        "bed_exit_risk": "low",
        "overall_state": "unknown",
        "confidence_score": 0.8,
        "signal_quality": "good",
        "source_summary": {},
        "transitions": [],
    }
    base.update(overrides)
    return base


def types(events):
    return [e["event_type"] for e in events]


def test_bed_entry_event():
    det = EventDetector()
    det.detect(state(occupied=False, movement_state="empty", overall_state="bed_empty"), T0)
    events = det.detect(state(occupied=True, overall_state="entered_bed"), T0 + timedelta(seconds=1))
    assert "bed_entry" in types(events)


def test_movement_and_stillness_events():
    det = EventDetector()
    det.detect(state(movement_state="still"), T0)
    moving = det.detect(state(movement_state="active_movement", overall_state="occupied_moving"),
                        T0 + timedelta(seconds=1))
    assert "movement_detected" in types(moving)
    still = det.detect(state(movement_state="still"), T0 + timedelta(seconds=2))
    assert "stillness_detected" in types(still)


def test_breathing_like_events():
    det = EventDetector()
    det.detect(state(), T0)
    detected = det.detect(state(breathing_like_detected=True,
                                overall_state="occupied_still_breathing_like"),
                          T0 + timedelta(seconds=1))
    assert "breathing_like_detected" in types(detected)
    lost = det.detect(state(breathing_like_detected=False,
                            overall_state="occupied_still_no_breathing_like"),
                      T0 + timedelta(seconds=2))
    assert "breathing_like_not_detected" in types(lost)
    # severity of the not-detected event must be review, not an alarm level
    event = next(e for e in lost if e["event_type"] == "breathing_like_not_detected")
    assert event["severity"] == "review"


def test_bed_exit_transitions_forwarded():
    det = EventDetector()
    det.detect(state(), T0)
    possible = det.detect(
        state(occupied=False, movement_state="empty", overall_state="possible_bed_exit",
              transitions=["possible_bed_exit"], bed_exit_risk="high"),
        T0 + timedelta(seconds=1),
    )
    assert "possible_bed_exit" in types(possible)
    confirmed = det.detect(
        state(occupied=False, movement_state="empty", overall_state="exited_bed",
              transitions=["bed_exit"]),
        T0 + timedelta(seconds=16),
    )
    assert "bed_exit" in types(confirmed)


def test_quality_warning_rate_limited():
    det = EventDetector()
    first = det.detect(state(signal_quality="poor"), T0)
    assert "signal_quality_warning" in types(first)
    soon = det.detect(state(signal_quality="poor"), T0 + timedelta(seconds=5))
    assert "signal_quality_warning" not in types(soon)
    later = det.detect(state(signal_quality="poor"), T0 + timedelta(seconds=40))
    assert "signal_quality_warning" in types(later)


def test_sensor_conflict_event():
    det = EventDetector()
    events = det.detect(state(signal_quality="conflicting", overall_state="sensor_uncertain"), T0)
    assert "sensor_conflict" in types(events)
    conflict = next(e for e in events if e["event_type"] == "sensor_conflict")
    assert conflict["severity"] == "review"


def test_no_events_on_steady_state():
    det = EventDetector()
    det.detect(state(breathing_like_detected=True,
                     overall_state="occupied_still_breathing_like"), T0)
    steady = det.detect(state(breathing_like_detected=True,
                              overall_state="occupied_still_breathing_like"),
                        T0 + timedelta(seconds=1))
    assert steady == []


def test_wording_is_non_clinical():
    det = EventDetector()
    det.detect(state(), T0)
    events = det.detect(state(breathing_like_detected=False,
                              overall_state="occupied_still_no_breathing_like"),
                        T0 + timedelta(seconds=1))
    text = " ".join((e["title"] or "") + " " + (e["description"] or "") for e in events).lower()
    for forbidden in ("patient in danger", "respiratory arrest", "medical emergency",
                      "clinical deterioration"):
        assert forbidden not in text
