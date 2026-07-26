import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, field_validator

from ..models.sensor import SENSOR_STATUSES, SENSOR_TYPES


class SensorCreate(BaseModel):
    name: str
    sensor_type: str
    location: str | None = None
    status: str = "mock"

    @field_validator("sensor_type")
    @classmethod
    def validate_type(cls, v: str) -> str:
        if v not in SENSOR_TYPES:
            raise ValueError(f"sensor_type must be one of {SENSOR_TYPES}")
        return v

    @field_validator("status")
    @classmethod
    def validate_status(cls, v: str) -> str:
        if v not in SENSOR_STATUSES:
            raise ValueError(f"status must be one of {SENSOR_STATUSES}")
        return v


class SensorUpdate(BaseModel):
    name: str | None = None
    location: str | None = None
    status: str | None = None

    @field_validator("status")
    @classmethod
    def validate_status(cls, v: str | None) -> str | None:
        if v is not None and v not in SENSOR_STATUSES:
            raise ValueError(f"status must be one of {SENSOR_STATUSES}")
        return v


class SensorOut(BaseModel):
    id: uuid.UUID
    name: str
    sensor_type: str
    location: str | None
    status: str
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)
