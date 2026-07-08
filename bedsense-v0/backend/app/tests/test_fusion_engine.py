"""Fusion engine rule tests (spec §12)."""
from datetime import datetime, timedelta, timezone

from app.services.fusion_engine import FusionEngine, ReadingsWindow

T0 = datetime(2026, 7, 8, 12, 0, 0, tzinfo=timezone.utc)


def window(pressure_occ, radar_occ, motion, breathing, pressure_val=None, ts=T0):
    return ReadingsWindow(
        pressure_occupancy=pressure_occ,
        radar_occupancy=radar_occ,
        radar_motion=motion,
        breathing_like=breathing,
        pressure_value=pressure_val or [v * 0.9 for v in pressure_occ],
        pressure_last_ts=ts,
        radar_last_ts=ts,
        pressure_reported_quality=0.92,
        radar_reported_quality=0.9,
    )


def occupied_still_window(breathing=0.72, ts=T0):
    return window(
        [0.9, 0.89, 0.9, 0.91], [0.86, 0.85, 0.87, 0.86],
        [0.1, 0.12, 0.09, 0.11], [breathing] * 4,
        pressure_val=[0.85, 0.86, 0.85, 0.86], ts=ts,
    )


def empty_window(ts=T0):
    return window([0.06, 0.05, 0.07], [0.08, 0.09, 0.07], [0.04, 0.05, 0.03],
                  [0.05, 0.06, 0.04], pressure_val=[0.05, 0.05, 0.06], ts=ts)


def test_empty_bed_state():
    result = FusionEngine().step(empty_window(), T0)
    assert result["occupied"] is False
    assert result["movement_state"] == "empty"
    assert result["overall_state"] == "bed_empty"
    assert result["signal_quality"] == "good"


def test_occupied_still_breathing_like():
    result = FusionEngine().step(occupied_still_window(), T0)
    assert result["occupied"] is True
    assert result["movement_state"] == "still"
    assert result["breathing_like_detected"] is True
    assert result["overall_state"] == "occupied_still_breathing_like"


def test_occupied_still_no_breathing_like():
    result = FusionEngine().step(occupied_still_window(breathing=0.1), T0)
    assert result["breathing_like_detected"] is False
    assert result["overall_state"] == "occupied_still_no_breathing_like"


def test_breathing_ambiguous_is_unknown():
    result = FusionEngine().step(occupied_still_window(breathing=0.45), T0)
    assert result["breathing_like_detected"] is None


def test_active_movement():
    result = FusionEngine().step(
        window([0.88, 0.9, 0.87], [0.9, 0.88, 0.89], [0.75, 0.8, 0.78], [0.4, 0.5, 0.3]),
        T0,
    )
    assert result["movement_state"] == "active_movement"
    assert result["overall_state"] == "occupied_moving"


def test_low_movement():
    result = FusionEngine().step(
        window([0.9, 0.9, 0.9], [0.88, 0.87, 0.88], [0.4, 0.45, 0.42], [0.7, 0.72, 0.71]),
        T0,
    )
    assert result["movement_state"] == "low_movement"
    # breathing still detectable during low movement per spec
    assert result["breathing_like_detected"] is True


def test_entered_bed_transition():
    engine = FusionEngine()
    engine.step(empty_window(T0), T0)
    result = engine.step(occupied_still_window(ts=T0 + timedelta(seconds=1)), T0 + timedelta(seconds=1))
    assert result["overall_state"] == "entered_bed"


def test_sensor_conflict_uncertain():
    result = FusionEngine().step(
        window([0.05, 0.06, 0.05], [0.9, 0.88, 0.91], [0.1, 0.1, 0.1], [0.7, 0.7, 0.7],
               pressure_val=[0.05, 0.05, 0.05]),
        T0,
    )
    assert result["signal_quality"] == "conflicting"
    assert result["overall_state"] == "sensor_uncertain"


def test_bed_exit_sequence():
    engine = FusionEngine(bed_exit_confirmation_seconds=15)
    t = T0
    # occupied and still for a few ticks
    for _ in range(3):
        engine.step(occupied_still_window(ts=t), t)
        t += timedelta(seconds=1)
    # exit: motion spike while occupancy collapses
    exit_win = window(
        [0.9, 0.5, 0.15, 0.1], [0.85, 0.6, 0.3, 0.2],
        [0.2, 0.85, 0.8, 0.4], [0.3, 0.2, 0.2, 0.1],
        pressure_val=[0.85, 0.5, 0.15, 0.1], ts=t,
    )
    result = engine.step(exit_win, t)
    assert "possible_bed_exit" in result["transitions"]
    assert result["bed_exit_risk"] == "high"
    assert result["overall_state"] == "possible_bed_exit"

    # occupancy stays low: not confirmed before 15 s...
    t2 = t + timedelta(seconds=10)
    mid = engine.step(empty_window(ts=t2), t2)
    assert "bed_exit" not in mid["transitions"]

    # ...confirmed at/after 15 s
    t3 = t + timedelta(seconds=16)
    confirmed = engine.step(empty_window(ts=t3), t3)
    assert "bed_exit" in confirmed["transitions"]
    assert confirmed["overall_state"] == "exited_bed"

    # and the tick after that is plain bed_empty
    t4 = t3 + timedelta(seconds=1)
    after = engine.step(empty_window(ts=t4), t4)
    assert after["overall_state"] == "bed_empty"


def test_pending_exit_cancels_when_reoccupied():
    engine = FusionEngine(bed_exit_confirmation_seconds=15)
    t = T0
    for _ in range(3):
        engine.step(occupied_still_window(ts=t), t)
        t += timedelta(seconds=1)
    exit_win = window(
        [0.9, 0.5, 0.15, 0.1], [0.85, 0.6, 0.3, 0.2],
        [0.2, 0.85, 0.8, 0.4], [0.3, 0.2, 0.2, 0.1],
        pressure_val=[0.85, 0.5, 0.15, 0.1], ts=t,
    )
    assert "possible_bed_exit" in engine.step(exit_win, t)["transitions"]
    # person settles back in before confirmation
    t2 = t + timedelta(seconds=5)
    back = engine.step(occupied_still_window(ts=t2), t2)
    assert back["occupied"] is True
    assert engine.pending_exit is False


def test_missing_data_unknown():
    result = FusionEngine().step(ReadingsWindow(), T0)
    assert result["occupied"] is None
    assert result["overall_state"] == "unknown"
    assert result["signal_quality"] == "missing"
