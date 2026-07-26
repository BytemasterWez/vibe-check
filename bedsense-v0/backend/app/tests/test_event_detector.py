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
    """signal_quality_warning cooldown is 2 minutes (V0.1 §3)."""
    det = EventDetector()
    first = det.detect(state(signal_quality="poor"), T0)
    assert "signal_quality_warning" in types(first)
    soon = det.detect(state(signal_quality="poor"), T0 + timedelta(seconds=60))
    assert "signal_quality_warning" not in types(soon)
    later = det.detect(state(signal_quality="poor"), T0 + timedelta(seconds=121))
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


def flap(det, breathing, t):
    """Drive a breathing detection through unknown and back, returning events."""
    det.detect(state(breathing_like_detected=None), t)
    return det.detect(state(breathing_like_detected=breathing), t + timedelta(seconds=1))


def test_breathing_detected_not_respammed_while_state_holds():
    """No repeat events while the state is unchanged (the V0 screenshot bug)."""
    det = EventDetector()
    first = det.detect(state(breathing_like_detected=True), T0)
    assert "breathing_like_detected" in types(first)
    # 60 consecutive confirming ticks must produce no further events.
    extra = []
    for i in range(1, 61):
        extra += types(det.detect(state(breathing_like_detected=True), T0 + timedelta(seconds=i)))
    assert extra == []


def test_breathing_detected_cooldown_suppresses_flapping():
    """Flapping True->unknown->True inside 5 minutes must not re-fire."""
    det = EventDetector()
    det.detect(state(breathing_like_detected=True), T0)
    assert "breathing_like_detected" not in types(flap(det, True, T0 + timedelta(seconds=30)))
    assert "breathing_like_detected" not in types(flap(det, True, T0 + timedelta(seconds=120)))
    # ...but a genuine re-detection after the 5-minute window does fire.
    assert "breathing_like_detected" in types(flap(det, True, T0 + timedelta(seconds=301)))


def test_breathing_lost_then_restored_fires_despite_cooldown():
    """A real lost->restored transition is signal, not spam: opposite events
    reset each other's cooldown."""
    det = EventDetector()
    det.detect(state(breathing_like_detected=True), T0)
    lost = det.detect(state(breathing_like_detected=False), T0 + timedelta(seconds=30))
    assert "breathing_like_not_detected" in types(lost)
    restored = det.detect(state(breathing_like_detected=True), T0 + timedelta(seconds=95))
    assert "breathing_like_detected" in types(restored)


def test_movement_and_stillness_cooldowns():
    det = EventDetector()
    det.detect(state(movement_state="still"), T0)
    assert "movement_detected" in types(
        det.detect(state(movement_state="active_movement"), T0 + timedelta(seconds=1))
    )
    # bounce back to still and move again inside the 60s movement cooldown
    det.detect(state(movement_state="still"), T0 + timedelta(seconds=20))
    assert "movement_detected" not in types(
        det.detect(state(movement_state="active_movement"), T0 + timedelta(seconds=30))
    )
    # after the cooldown it fires again
    det.detect(state(movement_state="still"), T0 + timedelta(seconds=100))
    assert "movement_detected" in types(
        det.detect(state(movement_state="active_movement"), T0 + timedelta(seconds=110))
    )


def test_stillness_cooldown_is_five_minutes():
    det = EventDetector()
    det.detect(state(movement_state="active_movement"), T0)
    assert "stillness_detected" in types(
        det.detect(state(movement_state="still"), T0 + timedelta(seconds=1))
    )
    det.detect(state(movement_state="active_movement"), T0 + timedelta(seconds=60))
    assert "stillness_detected" not in types(
        det.detect(state(movement_state="still"), T0 + timedelta(seconds=70))
    )
    det.detect(state(movement_state="active_movement"), T0 + timedelta(seconds=310))
    assert "stillness_detected" in types(
        det.detect(state(movement_state="still"), T0 + timedelta(seconds=320))
    )


def test_possible_bed_exit_deduplicated_within_15s():
    det = EventDetector()
    exiting = state(occupied=None, overall_state="possible_bed_exit",
                    transitions=["possible_bed_exit"], bed_exit_risk="high")
    assert "possible_bed_exit" in types(det.detect(exiting, T0))
    assert "possible_bed_exit" not in types(det.detect(exiting, T0 + timedelta(seconds=10)))
    assert "possible_bed_exit" in types(det.detect(exiting, T0 + timedelta(seconds=16)))


def test_bed_exit_fires_once_per_confirmed_exit():
    """bed_exit has no cooldown but the fusion engine raises the transition
    once, so each confirmed exit yields exactly one event."""
    det = EventDetector()
    confirmed = state(occupied=False, movement_state="empty",
                      overall_state="exited_bed", transitions=["bed_exit"])
    assert types(det.detect(confirmed, T0)).count("bed_exit") == 1
    # subsequent empty ticks carry no transition, so no more bed_exit events
    quiet = state(occupied=False, movement_state="empty", overall_state="bed_empty")
    assert "bed_exit" not in types(det.detect(quiet, T0 + timedelta(seconds=1)))


def test_cooldown_scale_compresses_windows_for_fast_demos():
    det = EventDetector(cooldown_scale=0.2)
    det.detect(state(breathing_like_detected=True), T0)
    # 5 min * 0.2 = 60 s in fast mode
    assert "breathing_like_detected" not in types(flap(det, True, T0 + timedelta(seconds=20)))
    assert "breathing_like_detected" in types(flap(det, True, T0 + timedelta(seconds=61)))


def test_sensor_conflict_cooldown():
    det = EventDetector()
    conflicting = state(signal_quality="conflicting", overall_state="sensor_uncertain")
    assert "sensor_conflict" in types(det.detect(conflicting, T0))
    assert "sensor_conflict" not in types(det.detect(conflicting, T0 + timedelta(seconds=60)))
    assert "sensor_conflict" in types(det.detect(conflicting, T0 + timedelta(seconds=121)))


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
