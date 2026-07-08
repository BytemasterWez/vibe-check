"""Configuration for CableLight BedSense V0.

Non-clinical research demonstrator for camera-less bed occupancy, movement
and breathing-like motion detection. Local-only by design.
"""
from pydantic_settings import BaseSettings, SettingsConfigDict

BOUNDARY_STATEMENT = (
    "CableLight BedSense V0 is a non-clinical research demonstrator for "
    "camera-less bed occupancy, movement and breathing-like motion detection. "
    "It does not monitor health, diagnose, predict deterioration, replace "
    "medical devices or support clinical decisions."
)

VERSION = "0.1.0"


class Settings(BaseSettings):
    database_url: str = "postgresql://bedsense:bedsense@localhost:5438/bedsense"
    local_only: bool = True
    enable_mock_sensor: bool = True
    enable_ai_explanations: bool = False

    fusion_interval_seconds: float = 1.0
    breathing_like_threshold: float = 0.60
    occupancy_threshold: float = 0.65
    occupancy_empty_threshold: float = 0.25
    bed_exit_confirmation_seconds: int = 15
    rolling_window_seconds: int = 10

    evidence_dir: str = "./evidence"
    data_dir: str = "./data"

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


settings = Settings()
