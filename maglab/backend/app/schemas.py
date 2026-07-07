"""Pydantic schemas for the upload API (fleshed out in Phase 7).

These mirror the iOS export models. Every uploaded object carries its
device-generated UUID so re-uploads are idempotent.
"""

import uuid
from datetime import datetime

from pydantic import BaseModel


class SurveyUpload(BaseModel):
    id: uuid.UUID
    name: str
    created_at: datetime
    target_type: str
    mount_position: str
    survey_pattern: str
    signal_module: str
    operator_notes: str = ""
    weather_notes: str = ""
    contamination_notes: list[str] = []
    share_setting: str
    app_version: str
    device_model: str
    consent_version: str
    share_precision: str


class RunUpload(BaseModel):
    id: uuid.UUID
    survey_id: uuid.UUID
    started_at: datetime
    ended_at: datetime | None = None
    is_complete: bool
    sample_count: int
    median_gps_accuracy_m: float | None = None
    max_anomaly_score: float | None = None
    high_confidence_anomaly_count: int = 0
    repeatability_group_id: uuid.UUID | None = None


class SampleUpload(BaseModel):
    id: uuid.UUID
    survey_id: uuid.UUID
    run_id: uuid.UUID
    timestamp_utc: datetime
    latitude: float | None = None
    longitude: float | None = None
    horizontal_accuracy_m: float | None = None
    altitude_m: float | None = None
    vertical_accuracy_m: float | None = None
    speed_mps: float | None = None
    course_deg: float | None = None
    mag_x_uT: float | None = None
    mag_y_uT: float | None = None
    mag_z_uT: float | None = None
    mag_total_uT: float | None = None
    accel_x: float | None = None
    accel_y: float | None = None
    accel_z: float | None = None
    gyro_x: float | None = None
    gyro_y: float | None = None
    gyro_z: float | None = None
    pitch: float | None = None
    roll: float | None = None
    yaw: float | None = None
    pressure_hPa: float | None = None
    relative_altitude_m: float | None = None
    local_baseline_uT: float | None = None
    local_residual_uT: float | None = None
    gps_quality_score: float
    motion_quality_score: float
    anomaly_score: float
    model_confidence: float
    likely_class: str
    quality_flags: list[str] = []


class MarkerUpload(BaseModel):
    id: uuid.UUID
    survey_id: uuid.UUID
    run_id: uuid.UUID
    timestamp_utc: datetime
    latitude: float | None = None
    longitude: float | None = None
    marker_type: str
    note: str = ""


class AnomalyEventUpload(BaseModel):
    id: uuid.UUID
    survey_id: uuid.UUID
    run_id: uuid.UUID
    start_time: datetime
    end_time: datetime
    centre_lat: float | None = None
    centre_lon: float | None = None
    sample_count: int
    max_score: float
    mean_score: float
    max_residual_uT: float
    confidence: float
    likely_class: str
    quality_flags: list[str] = []


class BulkSamplesUpload(BaseModel):
    samples: list[SampleUpload]


class BulkMarkersUpload(BaseModel):
    markers: list[MarkerUpload]


class BulkAnomaliesUpload(BaseModel):
    anomalies: list[AnomalyEventUpload]


class SurveyPackageUpload(BaseModel):
    """Complete survey package as exported by the iOS app."""

    survey: SurveyUpload
    runs: list[RunUpload] = []
    scoring_config_version: str
