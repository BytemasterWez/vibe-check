import uuid
from datetime import datetime

from sqlalchemy import Text
from sqlalchemy.orm import Mapped, mapped_column

from ..database import Base
from .common import UTCDateTime, UUIDType, new_uuid, utcnow

RISK_CATEGORIES = [
    "false_positive",
    "false_negative",
    "sensor_failure",
    "signal_conflict",
    "privacy",
    "regulatory",
    "user_misunderstanding",
    "technical",
]

RISK_STATUSES = ["open", "mitigated", "accepted", "needs_review"]


class RiskRegisterEntry(Base):
    __tablename__ = "risk_register"

    id: Mapped[uuid.UUID] = mapped_column(UUIDType, primary_key=True, default=new_uuid)
    risk_title: Mapped[str] = mapped_column(Text)
    risk_category: Mapped[str] = mapped_column(Text, default="technical")
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    possible_cause: Mapped[str | None] = mapped_column(Text, nullable=True)
    impact: Mapped[str | None] = mapped_column(Text, nullable=True)
    mitigation: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(Text, default="open")
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, onupdate=utcnow)
