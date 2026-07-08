"""Mock adapter scenario tests (spec §11)."""
from app.adapters.mock_adapter import (
    MOCK_SCENARIOS,
    MockBedSensorSet,
    MockPressureAdapter,
    MockRadarAdapter,
    scenario_profile,
)
import random

import pytest

RNG = lambda: random.Random(42)  # noqa: E731


def run_profile(scenario: str, t: float) -> dict:
    return scenario_profile(scenario, t, RNG())


def test_sample_envelope_shape():
    adapter = MockRadarAdapter("empty_bed", seed=1)
    adapter.connect()
    sample = adapter.read_sample()
    assert sample["sensor_type"] == "mock_radar"
    assert "timestamp_utc" in sample
    assert set(sample["metrics"]) == {
        "occupancy_score",
        "radar_motion_score",
        "radar_micro_motion_score",
        "breathing_like_score",
    }
    assert 0.0 <= sample["quality"]["quality_score"] <= 1.0
    assert sample["raw_payload"]["simulated"] is True


def test_empty_bed_pattern():
    p = run_profile("empty_bed", 5)
    assert p["pressure_value"] < 0.2
    assert p["pressure_occupancy_score"] < 0.25
    assert p["radar_motion_score"] < 0.25
    assert p["breathing_like_score"] < 0.3


def test_person_enters_bed_pattern():
    before = run_profile("person_enters_bed", 2)
    during = run_profile("person_enters_bed", 8)
    after = run_profile("person_enters_bed", 20)
    assert before["pressure_occupancy_score"] < 0.25
    assert during["radar_motion_score"] > 0.6  # motion spike during entry
    assert during["pressure_occupancy_score"] > before["pressure_occupancy_score"]
    assert after["pressure_occupancy_score"] > 0.65  # settled occupied


def test_still_breathing_like_pattern():
    values = [run_profile("person_still", t)["radar_micro_motion_score"] for t in range(20)]
    p = run_profile("person_still", 3)
    assert p["pressure_occupancy_score"] > 0.65
    assert p["radar_motion_score"] < 0.30
    assert run_profile("person_still", 5)["breathing_like_score"] >= 0.6
    # micro-motion must be rhythmic, not flat
    assert max(values) - min(values) > 0.3


def test_person_moving_pattern():
    p = run_profile("person_moving", 4)
    assert p["pressure_occupancy_score"] > 0.65
    assert p["radar_motion_score"] >= 0.4


def test_bed_exit_pattern():
    occupied = run_profile("bed_exit", 5)
    transition = run_profile("bed_exit", 11.5)
    after = run_profile("bed_exit", 20)
    assert occupied["pressure_occupancy_score"] > 0.65
    assert transition["radar_motion_score"] > 0.6  # exit motion spike
    assert after["pressure_occupancy_score"] < 0.25  # stable low afterwards


def test_composite_scenarios_resolve():
    for scenario in ("restless_night", "mixed_sequence"):
        for t in range(0, 160, 7):
            p = run_profile(scenario, t)
            assert 0.0 <= p["pressure_occupancy_score"] <= 1.0


def test_set_scenario_validates():
    adapter = MockPressureAdapter()
    with pytest.raises(ValueError):
        adapter.set_scenario("teleportation")
    for scenario in MOCK_SCENARIOS:
        adapter.set_scenario(scenario)


def test_sensor_set_steps_together():
    bed = MockBedSensorSet("person_still", seed=7)
    samples = bed.read_samples()
    assert {s["sensor_type"] for s in samples} == {"mock_pressure", "mock_radar"}
