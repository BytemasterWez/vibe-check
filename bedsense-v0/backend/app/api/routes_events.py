import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Event
from ..schemas.event_schema import EventCreate, EventOut

router = APIRouter(prefix="/events", tags=["events"])


@router.get("", response_model=list[EventOut])
def list_events(
    session_id: uuid.UUID | None = None,
    event_type: str | None = None,
    severity: str | None = None,
    limit: int = Query(100, le=2000),
    db: Session = Depends(get_db),
):
    query = select(Event).order_by(Event.timestamp_utc.desc()).limit(limit)
    if session_id:
        query = query.where(Event.session_id == session_id)
    if event_type:
        query = query.where(Event.event_type == event_type)
    if severity:
        query = query.where(Event.severity == severity)
    return db.execute(query).scalars().all()


@router.post("", response_model=EventOut, status_code=201)
def create_event(payload: EventCreate, db: Session = Depends(get_db)):
    event = Event(**payload.model_dump(exclude_none=True))
    db.add(event)
    db.commit()
    db.refresh(event)
    return event


@router.patch("/{event_id}/acknowledge", response_model=EventOut)
def acknowledge_event(event_id: uuid.UUID, db: Session = Depends(get_db)):
    event = db.get(Event, event_id)
    if not event:
        raise HTTPException(404, "Event not found")
    event.acknowledged = True
    db.commit()
    db.refresh(event)
    return event
