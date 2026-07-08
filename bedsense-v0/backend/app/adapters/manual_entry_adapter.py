"""Manual entry adapter — a tester types values in by hand.

Used for manual placeholder vitals (BP, glucose, temperature). Values are
queued via submit() and drained by read_sample(). Everything is marked
manual / not clinical.
"""
from .base_adapter import BaseSensorAdapter

MANUAL_METRICS = {
    "bp_systolic_manual": "mmHg",
    "bp_diastolic_manual": "mmHg",
    "glucose_placeholder": "mmol/L",
    "temperature_placeholder": "degC",
    "heart_rate_placeholder": "bpm",
    "spo2_placeholder": "%",
    "respiratory_rate_placeholder": "breaths/min",
    "co2_placeholder": "ppm",
}


class ManualEntryAdapter(BaseSensorAdapter):
    adapter_name = "manual_entry_adapter"
    sensor_type = "manual_bp"

    def __init__(self, sensor_type: str = "manual_bp") -> None:
        super().__init__()
        self.sensor_type = sensor_type
        self._queue: list[dict] = []

    def submit(self, metrics: dict[str, float], note: str | None = None) -> None:
        unknown = set(metrics) - set(MANUAL_METRICS)
        if unknown:
            raise ValueError(f"Unknown manual metrics: {sorted(unknown)}")
        self._queue.append(
            self.envelope(
                self.sensor_type,
                metrics,
                quality_score=1.0,
                status="good",
                raw_payload={"entry": "manual", "not_clinical": True, "note": note},
            )
        )

    def read_sample(self) -> dict:
        if not self._queue:
            raise StopIteration("No manual entries queued")
        return self._queue.pop(0)

    def pending(self) -> int:
        return len(self._queue)
