import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import Double, Index, Text
from sqlalchemy.orm import Mapped, mapped_column

from ..database import Base
from .common import JSONVariant, UTCDateTime, UUIDType, new_uuid, utcnow

METRICS = [
    "pressure_value",
    "occupancy_score",
    "radar_motion_score",
    "radar_micro_motion_score",
    "breathing_like_score",
    "movement_score",
    "heart_rate_placeholder",
    "spo2_placeholder",
    "respiratory_rate_placeholder",
    "co2_placeholder",
    "bp_systolic_manual",
    "bp_diastolic_manual",
    "glucose_placeholder",
    "temperature_placeholder",
]


class SensorReading(Base):
    __tablename__ = "sensor_readings"
    __table_args__ = (
        Index("ix_sensor_readings_ts", "timestamp_utc"),
        Index("ix_sensor_readings_session", "session_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUIDType, primary_key=True, default=new_uuid)
    timestamp_utc: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    session_id: Mapped[uuid.UUID | None] = mapped_column(UUIDType, nullable=True)
    sensor_id: Mapped[uuid.UUID | None] = mapped_column(UUIDType, nullable=True)
    sensor_type: Mapped[str] = mapped_column(Text)
    metric: Mapped[str] = mapped_column(Text)
    value_float: Mapped[float | None] = mapped_column(Double, nullable=True)
    value_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    unit: Mapped[str | None] = mapped_column(Text, nullable=True)
    quality_score: Mapped[float | None] = mapped_column(Double, nullable=True)
    raw_payload: Mapped[dict[str, Any] | None] = mapped_column(JSONVariant, nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
