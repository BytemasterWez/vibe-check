"""Placeholder for a future real mmWave radar adapter.

Not implemented in V0 — exists so the real hardware integration slots into
the same BaseSensorAdapter interface later without touching the fusion code.
"""
from .base_adapter import BaseSensorAdapter


class MmWavePlaceholderAdapter(BaseSensorAdapter):
    adapter_name = "mmwave_placeholder_adapter"
    sensor_type = "mmwave_radar_placeholder"

    def connect(self) -> bool:
        self.connected = False
        return False

    def read_sample(self) -> dict:
        raise NotImplementedError(
            "mmWave radar hardware is not integrated in BedSense V0. "
            "Use the mock_radar adapter instead."
        )

    def health_check(self) -> dict:
        info = super().health_check()
        info["status"] = "placeholder_not_implemented"
        return info
