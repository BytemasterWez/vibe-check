"""Placeholder for a future real pressure_mat_placeholder adapter.

Not implemented in V0 — exists so the real hardware integration slots into
the same BaseSensorAdapter interface later without touching the fusion code.
"""
from .base_adapter import BaseSensorAdapter


class PressurePlaceholderAdapter(BaseSensorAdapter):
    adapter_name = "pressure_placeholder_adapter"
    sensor_type = "pressure_mat_placeholder"

    def connect(self) -> bool:
        self.connected = False
        return False

    def read_sample(self) -> dict:
        raise NotImplementedError(
            "pressure_mat_placeholder hardware is not integrated in BedSense V0. "
            "Use the mock adapters or manual entry instead."
        )

    def health_check(self) -> dict:
        info = super().health_check()
        info["status"] = "placeholder_not_implemented"
        return info
