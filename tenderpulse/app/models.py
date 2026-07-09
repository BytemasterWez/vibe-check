"""Canonical schema. See docs/SCHEMA.md for the field-mapping rationale."""
from datetime import datetime, timezone

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


class RawRelease(Base):
    """Verbatim OCDS release payloads — the raw layer, kept for replay/audit."""

    __tablename__ = "raw_releases"
    __table_args__ = (UniqueConstraint("payload_hash", name="uq_raw_hash"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    source_name: Mapped[str] = mapped_column(String(40), index=True)
    ocid: Mapped[str] = mapped_column(String(120), index=True)
    release_id: Mapped[str] = mapped_column(String(160))
    payload: Mapped[dict] = mapped_column(JSON)
    payload_hash: Mapped[str] = mapped_column(String(64))
    fetched_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Notice(Base):
    """One canonical notice per OCID — normalised, deduplicated, join-ready."""

    __tablename__ = "notices"
    __table_args__ = (UniqueConstraint("ocid", name="uq_notice_ocid"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    source_name: Mapped[str] = mapped_column(String(40), index=True)
    source_url: Mapped[str] = mapped_column(Text, default="")
    ocid: Mapped[str] = mapped_column(String(120), index=True)
    release_id: Mapped[str] = mapped_column(String(160), default="")
    notice_type: Mapped[str] = mapped_column(String(40), index=True)  # tender/award/...
    status: Mapped[str] = mapped_column(String(40), default="")
    title: Mapped[str] = mapped_column(Text)
    description: Mapped[str] = mapped_column(Text, default="")
    buyer_name: Mapped[str] = mapped_column(Text, default="", index=True)
    buyer_id: Mapped[str] = mapped_column(String(160), default="")
    cpv_codes: Mapped[list] = mapped_column(JSON, default=list)
    cpv_descriptions: Mapped[list] = mapped_column(JSON, default=list)
    procurement_category: Mapped[str] = mapped_column(String(40), default="")
    value_amount: Mapped[float | None] = mapped_column(Float, nullable=True)
    value_min: Mapped[float | None] = mapped_column(Float, nullable=True)
    value_max: Mapped[float | None] = mapped_column(Float, nullable=True)
    value_currency: Mapped[str] = mapped_column(String(8), default="")
    published_date: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    deadline_date: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    contract_start: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    contract_end: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    regions: Mapped[list] = mapped_column(JSON, default=list)
    sme_suitable: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    vcse_suitable: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    raw_payload_hash: Mapped[str] = mapped_column(String(64), default="")
    ingested_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)


class Profile(Base):
    """A client matching profile: what kind of work this buyer wants to win."""

    __tablename__ = "profiles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(120), unique=True)
    keywords: Mapped[list] = mapped_column(JSON, default=list)
    cpv_prefixes: Mapped[list] = mapped_column(JSON, default=list)
    regions: Mapped[list] = mapped_column(JSON, default=list)
    min_value: Mapped[float | None] = mapped_column(Float, nullable=True)
    max_value: Mapped[float | None] = mapped_column(Float, nullable=True)
    require_sme: Mapped[bool] = mapped_column(Boolean, default=False)
    min_days_to_deadline: Mapped[int] = mapped_column(Integer, default=5)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Score(Base):
    """Explainable match score of a notice against a profile."""

    __tablename__ = "scores"
    __table_args__ = (UniqueConstraint("notice_id", "profile_id", name="uq_score"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    notice_id: Mapped[int] = mapped_column(ForeignKey("notices.id"), index=True)
    profile_id: Mapped[int] = mapped_column(ForeignKey("profiles.id"), index=True)
    score: Mapped[int] = mapped_column(Integer, index=True)
    reasons: Mapped[list] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class IngestRun(Base):
    """Audit trail for every pipeline run — freshness and failure visibility."""

    __tablename__ = "ingest_runs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    source_name: Mapped[str] = mapped_column(String(40), index=True)
    started_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="running")
    pages_fetched: Mapped[int] = mapped_column(Integer, default=0)
    releases_seen: Mapped[int] = mapped_column(Integer, default=0)
    inserted: Mapped[int] = mapped_column(Integer, default=0)
    updated: Mapped[int] = mapped_column(Integer, default=0)
    quarantined: Mapped[int] = mapped_column(Integer, default=0)
    error: Mapped[str] = mapped_column(Text, default="")


class QuarantinedRecord(Base):
    """Records that failed validation — never silently dropped."""

    __tablename__ = "quarantine"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    source_name: Mapped[str] = mapped_column(String(40))
    ocid: Mapped[str] = mapped_column(String(120), default="")
    reason: Mapped[str] = mapped_column(Text)
    payload: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
