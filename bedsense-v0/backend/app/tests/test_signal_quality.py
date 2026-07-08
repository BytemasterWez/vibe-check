"""Signal quality layer tests (spec §13)."""
from datetime import datetime, timedelta, timezone

from app.services import signal_quality as sq

NOW = datetime(2026, 7, 8, 12, 0, 0, tzinfo=timezone.utc)


def test_quality_state_bands():
    assert sq.quality_state(0.95) == "good"
    assert sq.quality_state(0.80) == "good"
    assert sq.quality_state(0.70) == "fair"
    assert sq.quality_state(0.45) == "poor"
    assert sq.quality_state(0.10) == "missing"
    assert sq.quality_state(None) == "missing"


def test_freshness_decay():
    assert sq.freshness_factor(NOW, NOW) == 1.0
    assert sq.freshness_factor(NOW - timedelta(seconds=3), NOW) == 1.0
    mid = sq.freshness_factor(NOW - timedelta(seconds=17.5), NOW)
    assert 0.4 < mid < 0.6
    assert sq.freshness_factor(NOW - timedelta(seconds=60), NOW) == 0.0
    assert sq.freshness_factor(None, NOW) == 0.0


def test_flatline_penalised():
    assert sq.flatline_factor([0.5] * 10) < 0.5
    assert sq.flatline_factor([0.5, 0.51, 0.49, 0.52, 0.5]) == 1.0


def test_impossible_values_penalised():
    assert sq.impossible_value_factor("occupancy_score", [0.2, 0.5, 1.8]) < 1.0
    assert sq.impossible_value_factor("occupancy_score", [0.2, 0.5, 0.9]) == 1.0
    assert sq.impossible_value_factor("heart_rate_placeholder", [400.0]) == 0.0


def test_good_window_scores_high():
    score = sq.score_sensor_window(
        {"occupancy_score": [0.88, 0.9, 0.91, 0.89, 0.9]},
        last_timestamp=NOW,
        reported_quality=0.93,
        now=NOW,
    )
    assert score >= 0.8


def test_stale_window_scores_zero():
    score = sq.score_sensor_window(
        {"occupancy_score": [0.9, 0.9, 0.9]},
        last_timestamp=NOW - timedelta(minutes=5),
        now=NOW,
    )
    assert score == 0.0


def test_conflict_detection():
    assert sq.detect_conflict(0.1, 0.9) is True
    assert sq.detect_conflict(0.9, 0.1) is True
    assert sq.detect_conflict(0.9, 0.85) is False
    assert sq.detect_conflict(0.1, 0.15) is False
    assert sq.detect_conflict(None, 0.9) is False


def test_combine_quality_conflict_state():
    score, state = sq.combine_quality([0.9, 0.85], conflict=True)
    assert state == "conflicting"
    assert score > 0.8
    score, state = sq.combine_quality([0.9, 0.85], conflict=False)
    assert state == "good"
    assert sq.combine_quality([], False) == (0.0, "missing")
