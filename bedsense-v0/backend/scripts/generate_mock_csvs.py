"""Generate the seeded replay CSVs in data/mock/ from the mock adapter profiles.

Run from bedsense-v0/backend:  python -m scripts.generate_mock_csvs
Deterministic (fixed seeds) so the committed files are reproducible.
"""
import csv
import random
from pathlib import Path

from app.adapters.mock_adapter import scenario_profile

OUT_DIR = Path(__file__).resolve().parents[2] / "data" / "mock"

# filename -> (scenario, duration_seconds)
FILES = {
    "empty_bed.csv": ("empty_bed", 120),
    "bed_exit.csv": ("bed_exit", 60),
    "restless_movement.csv": ("restless_night", 120),
    "still_breathing_like.csv": ("person_still", 120),
    "normal_night.csv": ("mixed_sequence", 145),
}


def write_file(name: str, scenario: str, duration: int) -> None:
    rng = random.Random(1234)
    path = OUT_DIR / name
    with open(path, "w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["t_seconds", "sensor_type", "metric", "value", "unit", "quality_score"])
        for t in range(duration):
            p = scenario_profile(scenario, float(t), rng)
            pressure_q = round(min(1.0, max(0.0, 0.92 + rng.gauss(0, 0.02))), 3)
            radar_q = round(min(1.0, max(0.0, 0.90 + rng.gauss(0, 0.02))), 3)
            rows = [
                (t, "mock_pressure", "pressure_value", p["pressure_value"], "normalized", pressure_q),
                (t, "mock_pressure", "occupancy_score", p["pressure_occupancy_score"], "score", pressure_q),
                (t, "mock_radar", "occupancy_score", p["radar_occupancy_score"], "score", radar_q),
                (t, "mock_radar", "radar_motion_score", p["radar_motion_score"], "score", radar_q),
                (t, "mock_radar", "radar_micro_motion_score", p["radar_micro_motion_score"], "score", radar_q),
                (t, "mock_radar", "breathing_like_score", p["breathing_like_score"], "score", radar_q),
            ]
            writer.writerows(rows)
    print(f"wrote {path} ({duration}s of {scenario})")


if __name__ == "__main__":
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for name, (scenario, duration) in FILES.items():
        write_file(name, scenario, duration)
