"""SQLAlchemy models — the backend schema contract (built out in Phase 7).

Mirrors the iOS SwiftData models field-for-field so survey packages upload
without translation. UUID primary keys come from the device, which is what
makes duplicate uploads idempotent. Geometry columns are PostGIS
(SRID 4326).
"""

import uuid
from datetime import datetime

from geoalchemy2 import Geometry
from sqlalchemy import (
    Boolean,
    DateTime,
    Double,
    ForeignKey,
    Index,
    Integer,
    Text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from .database import Base


class Contributor(Base):
    __tablename__ = "contributors"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    pseudonym: Mapped[str | None] = mapped_column(Text)
    invite_code_hash: Mapped[str | None] = mapped_column(Text)
    api_token_hash: Mapped[str | None] = mapped_column(Text)
    consent_version: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class Survey(Base):
    __tablename__ = "surveys"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    contributor_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("contributors.id"))
    name: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    target_type: Mapped[str | None] = mapped_column(Text)
    mount_position: Mapped[str | None] = mapped_column(Text)
    survey_pattern: Mapped[str | None] = mapped_column(Text)
    signal_module: Mapped[str | None] = mapped_column(Text)
    operator_notes: Mapped[str | None] = mapped_column(Text)
    weather_notes: Mapped[str | None] = mapped_column(Text)
    contamination_notes: Mapped[dict | None] = mapped_column(JSONB)
    share_setting: Mapped[str | None] = mapped_column(Text)
    app_version: Mapped[str | None] = mapped_column(Text)
    device_model: Mapped[str | None] = mapped_column(Text)
    uploaded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    geom = mapped_column(Geometry(srid=4326), nullable=True)


class SurveyRun(Base):
    __tablename__ = "survey_runs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    survey_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("surveys.id"))
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    is_complete: Mapped[bool] = mapped_column(Boolean, default=False)
    sample_count: Mapped[int] = mapped_column(Integer, default=0)
    median_gps_accuracy_m: Mapped[float | None] = mapped_column(Double)
    max_anomaly_score: Mapped[float | None] = mapped_column(Double)
    high_confidence_anomaly_count: Mapped[int] = mapped_column(Integer, default=0)
    repeatability_group_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    uploaded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class SensorSample(Base):
    __tablename__ = "sensor_samples"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    survey_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("surveys.id"))
    run_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("survey_runs.id"))
    contributor_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("contributors.id"))
    timestamp_utc: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    latitude: Mapped[float | None] = mapped_column(Double)
    longitude: Mapped[float | None] = mapped_column(Double)
    geom = mapped_column(Geometry("POINT", srid=4326), nullable=True)
    horizontal_accuracy_m: Mapped[float | None] = mapped_column(Double)
    altitude_m: Mapped[float | None] = mapped_column(Double)
    vertical_accuracy_m: Mapped[float | None] = mapped_column(Double)
    speed_mps: Mapped[float | None] = mapped_column(Double)
    course_deg: Mapped[float | None] = mapped_column(Double)
    mag_x_ut: Mapped[float | None] = mapped_column("mag_x_uT", Double)
    mag_y_ut: Mapped[float | None] = mapped_column("mag_y_uT", Double)
    mag_z_ut: Mapped[float | None] = mapped_column("mag_z_uT", Double)
    mag_total_ut: Mapped[float | None] = mapped_column("mag_total_uT", Double)
    accel_x: Mapped[float | None] = mapped_column(Double)
    accel_y: Mapped[float | None] = mapped_column(Double)
    accel_z: Mapped[float | None] = mapped_column(Double)
    gyro_x: Mapped[float | None] = mapped_column(Double)
    gyro_y: Mapped[float | None] = mapped_column(Double)
    gyro_z: Mapped[float | None] = mapped_column(Double)
    pitch: Mapped[float | None] = mapped_column(Double)
    roll: Mapped[float | None] = mapped_column(Double)
    yaw: Mapped[float | None] = mapped_column(Double)
    pressure_hpa: Mapped[float | None] = mapped_column("pressure_hPa", Double)
    relative_altitude_m: Mapped[float | None] = mapped_column(Double)
    local_baseline_ut: Mapped[float | None] = mapped_column("local_baseline_uT", Double)
    local_residual_ut: Mapped[float | None] = mapped_column("local_residual_uT", Double)
    gps_quality_score: Mapped[float | None] = mapped_column(Double)
    motion_quality_score: Mapped[float | None] = mapped_column(Double)
    anomaly_score: Mapped[float | None] = mapped_column(Double)
    model_confidence: Mapped[float | None] = mapped_column(Double)
    likely_class: Mapped[str | None] = mapped_column(Text)
    quality_flags: Mapped[dict | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)

    __table_args__ = (
        Index("ix_sensor_samples_survey_id", "survey_id"),
        Index("ix_sensor_samples_run_id", "run_id"),
        Index("ix_sensor_samples_contributor_id", "contributor_id"),
        Index("ix_sensor_samples_timestamp_utc", "timestamp_utc"),
        Index("ix_sensor_samples_anomaly_score", "anomaly_score"),
        Index("ix_sensor_samples_likely_class", "likely_class"),
        Index("ix_sensor_samples_geom", "geom", postgresql_using="gist"),
    )


class SurveyMarker(Base):
    __tablename__ = "survey_markers"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    survey_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("surveys.id"))
    run_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("survey_runs.id"))
    contributor_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("contributors.id"))
    timestamp_utc: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    latitude: Mapped[float | None] = mapped_column(Double)
    longitude: Mapped[float | None] = mapped_column(Double)
    geom = mapped_column(Geometry("POINT", srid=4326), nullable=True)
    marker_type: Mapped[str | None] = mapped_column(Text)
    note: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)


class AnomalyEvent(Base):
    __tablename__ = "anomaly_events"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    survey_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("surveys.id"))
    run_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("survey_runs.id"))
    contributor_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("contributors.id"))
    start_time: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    end_time: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    centre_lat: Mapped[float | None] = mapped_column(Double)
    centre_lon: Mapped[float | None] = mapped_column(Double)
    geom = mapped_column(Geometry("POINT", srid=4326), nullable=True)
    sample_count: Mapped[int] = mapped_column(Integer, default=0)
    max_score: Mapped[float | None] = mapped_column(Double)
    mean_score: Mapped[float | None] = mapped_column(Double)
    max_residual_ut: Mapped[float | None] = mapped_column("max_residual_uT", Double)
    confidence: Mapped[float | None] = mapped_column(Double)
    likely_class: Mapped[str | None] = mapped_column(Text)
    quality_flags: Mapped[dict | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)


class SyncBatch(Base):
    __tablename__ = "sync_batches"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    contributor_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("contributors.id"))
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    payload_kind: Mapped[str | None] = mapped_column(Text)
    item_count: Mapped[int] = mapped_column(Integer, default=0)
    app_version: Mapped[str | None] = mapped_column(Text)
    device_model: Mapped[str | None] = mapped_column(Text)


class ExportJob(Base):
    __tablename__ = "export_jobs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    requested_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    export_format: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str | None] = mapped_column(Text)
    output_path: Mapped[str | None] = mapped_column(Text)


class AnomalyLabel(Base):
    """Admin labelling of anomaly events — the training-data moat.

    Populated after Phase 9 tooling exists: known targets, false positives,
    repeatable unknowns, with provenance and notes for future model training.
    """

    __tablename__ = "anomaly_labels"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    anomaly_event_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("anomaly_events.id"))
    label: Mapped[str] = mapped_column(Text)
    label_confidence: Mapped[float | None] = mapped_column(Double)
    label_source: Mapped[str | None] = mapped_column(Text)
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
