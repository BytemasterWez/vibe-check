"""Signal quality scoring (spec §13).

Scores each sensor 0.0–1.0 from freshness, missing data, flatlined values,
impossible values, noise level and cross-sensor conflict, then maps the
score to a quality state.
"""
from datetime import datetime, timezone

import numpy as np

QUALITY_BANDS = [
    (0.80, "good"),
    (0.60, "fair"),
    (0.30, "poor"),
    (0.00, "missing"),
]

# Metrics whose valid range is 0..1 (scores). Others use loose sanity ranges.
SCORE_METRICS = {
    "occupancy_score",
    "radar_motion_score",
    "radar_micro_motion_score",
    "breathing_like_score",
    "movement_score",
    "pressure_value",
}

SANITY_RANGES = {
    "heart_rate_placeholder": (20, 250),
    "spo2_placeholder": (50, 100),
    "respiratory_rate_placeholder": (2, 60),
    "co2_placeholder": (0, 10000),
    "bp_systolic_manual": (50, 260),
    "bp_diastolic_manual": (30, 160),
    "glucose_placeholder": (1, 35),
    "temperature_placeholder": (30, 44),
}


def quality_state(score: float | None) -> str:
    if score is None:
        return "missing"
    for threshold, state in QUALITY_BANDS:
        if score >= threshold:
            return state
    return "missing"


def freshness_factor(last_timestamp: datetime | None, now: datetime | None = None,
                     stale_after_s: float = 5.0, dead_after_s: float = 30.0) -> float:
    """1.0 when fresh, linearly decaying to 0.0 once data is dead_after_s old."""
    if last_timestamp is None:
        return 0.0
    now = now or datetime.now(timezone.utc)
    if last_timestamp.tzinfo is None:
        last_timestamp = last_timestamp.replace(tzinfo=timezone.utc)
    age = (now - last_timestamp).total_seconds()
    if age <= stale_after_s:
        return 1.0
    if age >= dead_after_s:
        return 0.0
    return 1.0 - (age - stale_after_s) / (dead_after_s - stale_after_s)


def flatline_factor(values: list[float]) -> float:
    """Penalise a stream stuck on one exact value (a classic fault signature)."""
    if len(values) < 5:
        return 1.0
    if float(np.std(values)) < 1e-9:
        return 0.3
    return 1.0


def impossible_value_factor(metric: str, values: list[float]) -> float:
    if not values:
        return 1.0
    if metric in SCORE_METRICS:
        lo, hi = -0.001, 1.001
    else:
        lo, hi = SANITY_RANGES.get(metric, (-1e12, 1e12))
    bad = sum(1 for v in values if v < lo or v > hi)
    return max(0.0, 1.0 - bad / len(values))


def noise_factor(values: list[float]) -> float:
    """Penalise implausibly jumpy score streams (std of tick deltas)."""
    if len(values) < 4:
        return 1.0
    jitter = float(np.std(np.diff(values)))
    if jitter <= 0.25:
        return 1.0
    return max(0.4, 1.0 - (jitter - 0.25))


def score_sensor_window(metric_values: dict[str, list[float]],
                        last_timestamp: datetime | None,
                        reported_quality: float | None = None,
                        now: datetime | None = None) -> float:
    """Combine all factors into one 0.0–1.0 quality score for a sensor window."""
    fresh = freshness_factor(last_timestamp, now)
    if fresh == 0.0 or not metric_values:
        return 0.0
    factors = [fresh]
    for metric, values in metric_values.items():
        factors.append(flatline_factor(values))
        factors.append(impossible_value_factor(metric, values))
        factors.append(noise_factor(values))
    score = float(np.prod(factors))
    if reported_quality is not None:
        score = score * 0.5 + min(reported_quality, 1.0) * 0.5 * fresh
    return round(max(0.0, min(1.0, score)), 3)


def detect_conflict(pressure_occupancy: float | None,
                    radar_occupancy: float | None) -> bool:
    """True when one sensor says empty while the other says strong presence."""
    if pressure_occupancy is None or radar_occupancy is None:
        return False
    return (
        (pressure_occupancy < 0.25 and radar_occupancy >= 0.65)
        or (radar_occupancy < 0.25 and pressure_occupancy >= 0.65)
    )


def combine_quality(scores: list[float], conflict: bool) -> tuple[float, str]:
    """Overall quality score + state across sensors."""
    if not scores:
        return 0.0, "missing"
    overall = round(float(np.mean(scores)), 3)
    if conflict:
        return overall, "conflicting"
    return overall, quality_state(overall)
