import uuid

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import BedState, Event, SensorReading
from ..schemas.event_schema import BedStateOut

router = APIRouter(prefix="/state", tags=["state"])


@router.get("/current")
def current_state(db: Session = Depends(get_db)):
    state = db.execute(
        select(BedState).order_by(BedState.timestamp_utc.desc()).limit(1)
    ).scalar_one_or_none()
    last_event = db.execute(
        select(Event).order_by(Event.timestamp_utc.desc()).limit(1)
    ).scalar_one_or_none()
    last_reading = db.execute(
        select(SensorReading).order_by(SensorReading.timestamp_utc.desc()).limit(1)
    ).scalar_one_or_none()

    return {
        "state": BedStateOut.model_validate(state).model_dump() if state else None,
        "last_event": {
            "event_type": last_event.event_type,
            "severity": last_event.severity,
            "title": last_event.title,
            "timestamp_utc": last_event.timestamp_utc,
        } if last_event else None,
        "last_reading_at": last_reading.timestamp_utc if last_reading else None,
        "prototype_status": "Non-clinical research mode",
    }


@router.get("/history", response_model=list[BedStateOut])
def state_history(
    session_id: uuid.UUID | None = None,
    limit: int = Query(100, le=5000),
    db: Session = Depends(get_db),
):
    query = select(BedState).order_by(BedState.timestamp_utc.desc()).limit(limit)
    if session_id:
        query = query.where(BedState.session_id == session_id)
    return db.execute(query).scalars().all()
