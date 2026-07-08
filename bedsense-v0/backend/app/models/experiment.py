import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import Text
from sqlalchemy.orm import Mapped, mapped_column

from ..database import Base
from .common import JSONVariant, UTCDateTime, UUIDType, new_uuid, utcnow

SCENARIOS = [
    "empty_bed",
    "person_enters_bed",
    "person_still",
    "person_moving",
    "breathing_like_motion",
    "bed_exit",
    "restless_night",
    "mixed_sequence",
    "csv_replay",
    "manual_test",
]

PASS_FAIL = ["not_assessed", "pass", "fail", "partial"]


class ExperimentSession(Base):
    __tablename__ = "experiment_sessions"

    id: Mapped[uuid.UUID] = mapped_column(UUIDType, primary_key=True, default=new_uuid)
    name: Mapped[str] = mapped_column(Text)
    scenario: Mapped[str] = mapped_column(Text, default="manual_test")
    operator_name: Mapped[str | None] = mapped_column(Text, nullable=True)
    started_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    ended_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    expected_events: Mapped[list[Any] | None] = mapped_column(JSONVariant, nullable=True)
    actual_results: Mapped[dict[str, Any] | None] = mapped_column(JSONVariant, nullable=True)
    pass_fail: Mapped[str] = mapped_column(Text, default="not_assessed")
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
