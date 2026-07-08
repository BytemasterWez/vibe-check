"""Shared column helpers so models work on PostgreSQL (JSONB) and SQLite (tests)."""
import uuid
from datetime import datetime, timezone

from sqlalchemy import JSON, DateTime, Uuid
from sqlalchemy.dialects.postgresql import JSONB

JSONVariant = JSON().with_variant(JSONB(), "postgresql")
UUIDType = Uuid(as_uuid=True)
UTCDateTime = DateTime(timezone=True)


def new_uuid() -> uuid.UUID:
    return uuid.uuid4()


def utcnow() -> datetime:
    return datetime.now(timezone.utc)
