import uuid

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import SensorReading
from ..schemas.reading_schema import ReadingBulkCreate, ReadingCreate, ReadingOut
from .deps import require_session

router = APIRouter(prefix="/readings", tags=["readings"])


@router.get("", response_model=list[ReadingOut])
def list_readings(
    session_id: uuid.UUID | None = None,
    sensor_type: str | None = None,
    metric: str | None = None,
    limit: int = Query(100, le=2000),
    db: Session = Depends(get_db),
):
    query = select(SensorReading).order_by(SensorReading.timestamp_utc.desc()).limit(limit)
    if session_id:
        query = query.where(SensorReading.session_id == session_id)
    if sensor_type:
        query = query.where(SensorReading.sensor_type == sensor_type)
    if metric:
        query = query.where(SensorReading.metric == metric)
    return db.execute(query).scalars().all()


@router.post("", response_model=ReadingOut, status_code=201)
def create_reading(payload: ReadingCreate, db: Session = Depends(get_db)):
    data = payload.model_dump(exclude_none=True)
    data["session_id"] = require_session(data.get("session_id"), db)
    reading = SensorReading(**data)
    db.add(reading)
    db.commit()
    db.refresh(reading)
    return reading


@router.post("/bulk", status_code=201)
def create_readings_bulk(payload: ReadingBulkCreate, db: Session = Depends(get_db)):
    readings = []
    for r in payload.readings:
        data = r.model_dump(exclude_none=True)
        data["session_id"] = require_session(data.get("session_id"), db)
        readings.append(SensorReading(**data))
    db.add_all(readings)
    db.commit()
    return {"inserted": len(readings)}
