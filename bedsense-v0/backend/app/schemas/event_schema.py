import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, field_validator

from ..models.event import EVENT_TYPES, SEVERITIES


class EventCreate(BaseModel):
    timestamp_utc: datetime | None = None
    session_id: uuid.UUID | None = None
    event_type: str
    severity: str = "info"
    confidence_score: float | None = None
    title: str | None = None
    description: str | None = None
    evidence: dict[str, Any] | None = None

    @field_validator("event_type")
    @classmethod
    def validate_event_type(cls, v: str) -> str:
        if v not in EVENT_TYPES:
            raise ValueError(f"event_type must be one of {EVENT_TYPES}")
        return v

    @field_validator("severity")
    @classmethod
    def validate_severity(cls, v: str) -> str:
        if v not in SEVERITIES:
            raise ValueError(f"severity must be one of {SEVERITIES}")
        return v


class EventOut(BaseModel):
    id: uuid.UUID
    timestamp_utc: datetime
    session_id: uuid.UUID | None
    event_type: str
    severity: str
    confidence_score: float | None
    title: str | None
    description: str | None
    evidence: dict[str, Any] | None
    acknowledged: bool
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class BedStateOut(BaseModel):
    id: uuid.UUID
    timestamp_utc: datetime
    session_id: uuid.UUID | None
    occupied: bool | None
    movement_state: str
    breathing_like_detected: bool | None
    bed_exit_risk: str
    overall_state: str
    confidence_score: float | None
    signal_quality: str
    explanation: str | None
    source_summary: dict[str, Any] | None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
