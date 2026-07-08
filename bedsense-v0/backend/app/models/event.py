import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import Boolean, Double, Index, Text
from sqlalchemy.orm import Mapped, mapped_column

from ..database import Base
from .common import JSONVariant, UTCDateTime, UUIDType, new_uuid, utcnow

EVENT_TYPES = [
    "bed_empty",
    "bed_entry",
    "movement_detected",
    "stillness_detected",
    "breathing_like_detected",
    "breathing_like_not_detected",
    "possible_bed_exit",
    "bed_exit",
    "signal_quality_warning",
    "sensor_conflict",
    "manual_note",
    "test_marker",
]

SEVERITIES = ["info", "low", "medium", "high", "review"]


class Event(Base):
    __tablename__ = "events"
    __table_args__ = (
        Index("ix_events_ts", "timestamp_utc"),
        Index("ix_events_session", "session_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUIDType, primary_key=True, default=new_uuid)
    timestamp_utc: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    session_id: Mapped[uuid.UUID | None] = mapped_column(UUIDType, nullable=True)
    event_type: Mapped[str] = mapped_column(Text)
    severity: Mapped[str] = mapped_column(Text, default="info")
    confidence_score: Mapped[float | None] = mapped_column(Double, nullable=True)
    title: Mapped[str | None] = mapped_column(Text, nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    evidence: Mapped[dict[str, Any] | None] = mapped_column(JSONVariant, nullable=True)
    acknowledged: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
