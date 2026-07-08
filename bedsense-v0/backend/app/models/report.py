import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import Text
from sqlalchemy.orm import Mapped, mapped_column

from ..database import Base
from .common import JSONVariant, UTCDateTime, UUIDType, new_uuid, utcnow


class EvidenceReport(Base):
    __tablename__ = "evidence_reports"

    id: Mapped[uuid.UUID] = mapped_column(UUIDType, primary_key=True, default=new_uuid)
    name: Mapped[str] = mapped_column(Text)
    session_id: Mapped[uuid.UUID | None] = mapped_column(UUIDType, nullable=True)
    markdown_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    csv_paths: Mapped[dict[str, Any] | None] = mapped_column(JSONVariant, nullable=True)
    json_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    summary: Mapped[dict[str, Any] | None] = mapped_column(JSONVariant, nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
