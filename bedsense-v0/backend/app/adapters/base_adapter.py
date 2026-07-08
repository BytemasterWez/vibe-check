"""Common sensor adapter interface for CableLight BedSense V0.

Every adapter — mock, replay, manual or (later) real hardware — implements
the same four methods and returns samples in the same envelope:

{
  "timestamp_utc": "2026-07-08T12:00:00Z",
  "sensor_type": "mock_radar",
  "metrics": {"radar_motion_score": 0.12, ...},
  "quality": {"quality_score": 0.91, "status": "good"},
  "raw_payload": {}
}
"""
from datetime import datetime, timezone


class BaseSensorAdapter:
    adapter_name: str = "base"
    sensor_type: str = "base"

    def __init__(self) -> None:
        self.connected = False

    def connect(self) -> bool:
        self.connected = True
        return True

    def disconnect(self) -> bool:
        self.connected = False
        return True

    def read_sample(self) -> dict:
        raise NotImplementedError

    def health_check(self) -> dict:
        return {
            "adapter_name": self.adapter_name,
            "sensor_type": self.sensor_type,
            "connected": self.connected,
            "status": "ok" if self.connected else "disconnected",
        }

    @staticmethod
    def now_iso() -> str:
        return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    @staticmethod
    def envelope(sensor_type: str, metrics: dict, quality_score: float,
                 status: str = "good", raw_payload: dict | None = None,
                 timestamp_utc: str | None = None) -> dict:
        return {
            "timestamp_utc": timestamp_utc or BaseSensorAdapter.now_iso(),
            "sensor_type": sensor_type,
            "metrics": metrics,
            "quality": {"quality_score": round(quality_score, 3), "status": status},
            "raw_payload": raw_payload or {},
        }
