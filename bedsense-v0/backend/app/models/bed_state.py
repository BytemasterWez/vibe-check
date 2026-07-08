import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import Boolean, Double, Index, Text
from sqlalchemy.orm import Mapped, mapped_column

from ..database import Base
from .common import JSONVariant, UTCDateTime, UUIDType, new_uuid, utcnow

MOVEMENT_STATES = ["empty", "still", "low_movement", "active_movement", "unknown"]
BED_EXIT_RISKS = ["low", "medium", "high", "unknown"]
OVERALL_STATES = [
    "bed_empty",
    "entered_bed",
    "occupied_still_breathing_like",
    "occupied_still_no_breathing_like",
    "occupied_moving",
    "possible_bed_exit",
    "exited_bed",
    "sensor_uncertain",
    "unknown",
]
SIGNAL_QUALITIES = ["good", "fair", "poor", "missing", "conflicting"]


class BedState(Base):
    __tablename__ = "bed_states"
    __table_args__ = (
        Index("ix_bed_states_ts", "timestamp_utc"),
        Index("ix_bed_states_session", "session_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUIDType, primary_key=True, default=new_uuid)
    timestamp_utc: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    session_id: Mapped[uuid.UUID | None] = mapped_column(UUIDType, nullable=True)
    occupied: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    movement_state: Mapped[str] = mapped_column(Text, default="unknown")
    breathing_like_detected: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    bed_exit_risk: Mapped[str] = mapped_column(Text, default="unknown")
    overall_state: Mapped[str] = mapped_column(Text, default="unknown")
    confidence_score: Mapped[float | None] = mapped_column(Double, nullable=True)
    signal_quality: Mapped[str] = mapped_column(Text, default="missing")
    explanation: Mapped[str | None] = mapped_column(Text, nullable=True)
    source_summary: Mapped[dict[str, Any] | None] = mapped_column(JSONVariant, nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
