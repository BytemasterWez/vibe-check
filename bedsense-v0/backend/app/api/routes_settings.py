from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..config import settings

router = APIRouter(prefix="/settings", tags=["settings"])


class SettingsUpdate(BaseModel):
    enable_mock_sensor: bool | None = None
    enable_ai_explanations: bool | None = None
    fusion_interval_seconds: float | None = None
    breathing_like_threshold: float | None = None
    occupancy_threshold: float | None = None
    bed_exit_confirmation_seconds: int | None = None
    evidence_dir: str | None = None
    local_only: bool | None = None  # rejected below — locked true


def _snapshot() -> dict:
    return {
        "local_only": settings.local_only,
        "local_only_locked": True,
        "enable_mock_sensor": settings.enable_mock_sensor,
        "enable_ai_explanations": settings.enable_ai_explanations,
        "fusion_interval_seconds": settings.fusion_interval_seconds,
        "breathing_like_threshold": settings.breathing_like_threshold,
        "occupancy_threshold": settings.occupancy_threshold,
        "bed_exit_confirmation_seconds": settings.bed_exit_confirmation_seconds,
        "evidence_dir": settings.evidence_dir,
    }


@router.get("")
def get_settings():
    return _snapshot()


@router.patch("")
def update_settings(payload: SettingsUpdate):
    if payload.local_only is not None and payload.local_only is not True:
        raise HTTPException(400, "local_only is locked to true in BedSense V0")
    updates = payload.model_dump(exclude_unset=True, exclude_none=True)
    updates.pop("local_only", None)
    for key, value in updates.items():
        setattr(settings, key, value)
    return _snapshot()
