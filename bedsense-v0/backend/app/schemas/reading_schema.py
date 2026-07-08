import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, field_validator

from ..models.reading import METRICS


class ReadingCreate(BaseModel):
    timestamp_utc: datetime | None = None
    session_id: uuid.UUID | None = None
    sensor_id: uuid.UUID | None = None
    sensor_type: str
    metric: str
    value_float: float | None = None
    value_text: str | None = None
    unit: str | None = None
    quality_score: float | None = None
    raw_payload: dict[str, Any] | None = None

    @field_validator("metric")
    @classmethod
    def validate_metric(cls, v: str) -> str:
        if v not in METRICS:
            raise ValueError(f"metric must be one of {METRICS}")
        return v


class ReadingBulkCreate(BaseModel):
    readings: list[ReadingCreate]


class ReadingOut(BaseModel):
    id: uuid.UUID
    timestamp_utc: datetime
    session_id: uuid.UUID | None
    sensor_id: uuid.UUID | None
    sensor_type: str
    metric: str
    value_float: float | None
    value_text: str | None
    unit: str | None
    quality_score: float | None
    raw_payload: dict[str, Any] | None
    created_at: datetime

    class Config:
        from_attributes = True
