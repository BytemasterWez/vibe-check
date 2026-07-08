"""Mock sensor adapter — simulates a pressure mat and an mmWave-style radar.

Five core scenarios (spec §11), plus composite sequences. All values are
synthetic and non-clinical. Profiles are deterministic given (scenario, tick,
seed) so tests and CSV generation are repeatable.
"""
import math
import random

from .base_adapter import BaseSensorAdapter

MOCK_SCENARIOS = [
    "empty_bed",
    "person_enters_bed",
    "person_still",
    "breathing_like_motion",
    "person_moving",
    "bed_exit",
    "restless_night",
    "mixed_sequence",
]

# Composite scenarios are chains of (base_scenario, duration_seconds).
COMPOSITE_SCENARIOS: dict[str, list[tuple[str, int]]] = {
    "restless_night": [
        ("person_still", 30),
        ("person_moving", 15),
        ("person_still", 30),
        ("person_moving", 15),
        ("person_still", 30),
    ],
    "mixed_sequence": [
        ("empty_bed", 15),
        ("person_enters_bed", 20),
        ("person_still", 30),
        ("person_moving", 20),
        ("person_still", 20),
        ("bed_exit", 25),
        ("empty_bed", 15),
    ],
}


def _resolve(scenario: str, t: float) -> tuple[str, float]:
    """Map (composite scenario, elapsed seconds) to (base scenario, local t)."""
    chain = COMPOSITE_SCENARIOS.get(scenario)
    if not chain:
        return scenario, t
    elapsed = 0.0
    for base, duration in chain:
        if t < elapsed + duration:
            return base, t - elapsed
        elapsed += duration
    last_base, last_dur = chain[-1]
    return last_base, last_dur

def scenario_profile(scenario: str, t: float, rng: random.Random) -> dict:
    """Ground-truth synthetic signal values for a scenario at time t seconds.

    Returns all raw metric values for one tick, shared by the pressure and
    radar mock adapters so both sensors tell a consistent story.
    """
    base, t = _resolve(scenario, t)
    n = rng.gauss  # noise helper

    if base == "empty_bed":
        return {
            "pressure_value": _clip(0.05 + n(0, 0.01)),
            "pressure_occupancy_score": _clip(0.06 + n(0, 0.02)),
            "radar_occupancy_score": _clip(0.08 + n(0, 0.03)),
            "radar_motion_score": _clip(0.04 + n(0, 0.02)),
            "radar_micro_motion_score": _clip(0.05 + n(0, 0.02)),
            "breathing_like_score": _clip(0.05 + n(0, 0.03)),
        }

    if base == "person_enters_bed":
        if t < 5:  # bed still empty
            return scenario_profile("empty_bed", t, rng)
        if t < 10:  # entry transition: motion spike, pressure ramping up
            ramp = (t - 5) / 5.0
            return {
                "pressure_value": _clip(0.05 + 0.80 * ramp + n(0, 0.03)),
                "pressure_occupancy_score": _clip(0.10 + 0.80 * ramp + n(0, 0.04)),
                "radar_occupancy_score": _clip(0.30 + 0.60 * ramp + n(0, 0.05)),
                "radar_motion_score": _clip(0.80 + n(0, 0.08)),
                "radar_micro_motion_score": _clip(0.60 + n(0, 0.10)),
                "breathing_like_score": _clip(0.30 + n(0, 0.10)),
            }
        return scenario_profile("person_still", t - 10, rng)

    if base in ("person_still", "breathing_like_motion"):
        # Stable pressure, low gross motion, rhythmic micro-motion (~15/min).
        breath_phase = math.sin(2 * math.pi * t / 4.0)
        return {
            "pressure_value": _clip(0.85 + n(0, 0.015)),
            "pressure_occupancy_score": _clip(0.90 + n(0, 0.02)),
            "radar_occupancy_score": _clip(0.85 + n(0, 0.03)),
            "radar_motion_score": _clip(0.10 + n(0, 0.03)),
            "radar_micro_motion_score": _clip(0.50 + 0.25 * breath_phase + n(0, 0.03)),
            "breathing_like_score": _clip(0.72 + 0.05 * breath_phase + n(0, 0.03)),
        }

    if base == "person_moving":
        wobble = math.sin(2 * math.pi * t / 7.0)
        return {
            "pressure_value": _clip(0.80 + 0.12 * wobble + n(0, 0.05)),
            "pressure_occupancy_score": _clip(0.88 + n(0, 0.04)),
            "radar_occupancy_score": _clip(0.88 + n(0, 0.04)),
            "radar_motion_score": _clip(0.70 + 0.15 * wobble + n(0, 0.08)),
            "radar_micro_motion_score": _clip(0.55 + n(0, 0.15)),
            "breathing_like_score": _clip(0.40 + n(0, 0.15)),
        }

    if base == "bed_exit":
        if t < 10:  # occupied and still
            return scenario_profile("person_still", t, rng)
        if t < 13:  # exit transition: motion spike while pressure drops
            drop = (t - 10) / 3.0
            return {
                "pressure_value": _clip(0.85 - 0.80 * drop + n(0, 0.03)),
                "pressure_occupancy_score": _clip(0.90 - 0.80 * drop + n(0, 0.04)),
                "radar_occupancy_score": _clip(0.85 - 0.60 * drop + n(0, 0.05)),
                "radar_motion_score": _clip(0.85 + n(0, 0.06)),
                "radar_micro_motion_score": _clip(0.60 + n(0, 0.10)),
                "breathing_like_score": _clip(0.25 + n(0, 0.10)),
            }
        return scenario_profile("empty_bed", t - 13, rng)

    raise ValueError(f"Unknown mock scenario: {scenario}")


def _clip(v: float, lo: float = 0.0, hi: float = 1.0) -> float:
    return round(max(lo, min(hi, v)), 4)


class MockRadarAdapter(BaseSensorAdapter):
    adapter_name = "mock_radar_adapter"
    sensor_type = "mock_radar"

    def __init__(self, scenario: str = "empty_bed", seed: int | None = None) -> None:
        super().__init__()
        self.scenario = scenario
        self.t = 0.0
        self.rng = random.Random(seed)

    def set_scenario(self, scenario: str) -> None:
        if scenario not in MOCK_SCENARIOS:
            raise ValueError(f"Unknown mock scenario: {scenario}")
        self.scenario = scenario
        self.t = 0.0

    def read_sample(self) -> dict:
        profile = scenario_profile(self.scenario, self.t, self.rng)
        self.t += 1.0
        quality = _clip(0.90 + self.rng.gauss(0, 0.03), 0.0, 1.0)
        return self.envelope(
            self.sensor_type,
            {
                "occupancy_score": profile["radar_occupancy_score"],
                "radar_motion_score": profile["radar_motion_score"],
                "radar_micro_motion_score": profile["radar_micro_motion_score"],
                "breathing_like_score": profile["breathing_like_score"],
            },
            quality_score=quality,
            status="good" if quality >= 0.8 else "fair",
            raw_payload={"scenario": self.scenario, "t": self.t - 1.0, "simulated": True},
        )


class MockPressureAdapter(BaseSensorAdapter):
    adapter_name = "mock_pressure_adapter"
    sensor_type = "mock_pressure"

    def __init__(self, scenario: str = "empty_bed", seed: int | None = None) -> None:
        super().__init__()
        self.scenario = scenario
        self.t = 0.0
        self.rng = random.Random(seed)

    def set_scenario(self, scenario: str) -> None:
        if scenario not in MOCK_SCENARIOS:
            raise ValueError(f"Unknown mock scenario: {scenario}")
        self.scenario = scenario
        self.t = 0.0

    def read_sample(self) -> dict:
        profile = scenario_profile(self.scenario, self.t, self.rng)
        self.t += 1.0
        quality = _clip(0.92 + self.rng.gauss(0, 0.03), 0.0, 1.0)
        return self.envelope(
            self.sensor_type,
            {
                "pressure_value": profile["pressure_value"],
                "occupancy_score": profile["pressure_occupancy_score"],
                "movement_score": profile["radar_motion_score"],
            },
            quality_score=quality,
            status="good" if quality >= 0.8 else "fair",
            raw_payload={"scenario": self.scenario, "t": self.t - 1.0, "simulated": True},
        )


class MockBedSensorSet:
    """Convenience wrapper stepping the radar + pressure mocks together."""

    def __init__(self, scenario: str = "empty_bed", seed: int | None = None) -> None:
        self.radar = MockRadarAdapter(scenario, seed)
        self.pressure = MockPressureAdapter(scenario, None if seed is None else seed + 1)
        self.scenario = scenario

    def set_scenario(self, scenario: str) -> None:
        self.radar.set_scenario(scenario)
        self.pressure.set_scenario(scenario)
        self.scenario = scenario

    def read_samples(self) -> list[dict]:
        return [self.pressure.read_sample(), self.radar.read_sample()]

    def scenario_finished(self) -> bool:
        chain = COMPOSITE_SCENARIOS.get(self.scenario)
        if chain:
            total = sum(d for _, d in chain)
            return self.radar.t >= total
        finite = {"person_enters_bed": 40, "bed_exit": 45}
        limit = finite.get(self.scenario)
        return limit is not None and self.radar.t >= limit
