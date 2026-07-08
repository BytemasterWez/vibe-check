import uuid
from datetime import datetime

from sqlalchemy import Text
from sqlalchemy.orm import Mapped, mapped_column

from ..database import Base
from .common import UTCDateTime, UUIDType, new_uuid, utcnow

SENSOR_TYPES = [
    "mock_radar",
    "mock_pressure",
    "mock_ppg",
    "mock_co2",
    "manual_bp",
    "manual_glucose",
    "manual_temperature",
    "csv_replay",
    "mmwave_radar_placeholder",
    "pressure_mat_placeholder",
    "load_cell_placeholder",
    "ppg_placeholder",
    "ecg_placeholder",
    "co2_placeholder",
]

SENSOR_STATUSES = ["active", "inactive", "fault", "mock", "manual", "replay"]


class Sensor(Base):
    __tablename__ = "sensors"

    id: Mapped[uuid.UUID] = mapped_column(UUIDType, primary_key=True, default=new_uuid)
    name: Mapped[str] = mapped_column(Text)
    sensor_type: Mapped[str] = mapped_column(Text)
    location: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(Text, default="mock")
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, onupdate=utcnow)
