import uuid

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import BedState, Event, SensorReading
from ..schemas.event_schema import BedStateOut
from ..worker import runtime

router = APIRouter(prefix="/state", tags=["state"])


@router.get("/current")
def current_state(
    session_id: uuid.UUID | None = None,
    all_sessions: bool = False,
    db: Session = Depends(get_db),
):
    """Current bed state.

    Defaults to the active session (V0.1 §2) so a demo never shows stale
    state or events from an earlier scenario. Pass all_sessions=true for the
    unscoped view, or session_id to inspect a specific past session.
    """
    scope_id = session_id or (None if all_sessions else runtime.current_session_id)
    scoped = scope_id is not None

    def scope(query, model):
        return query.where(model.session_id == scope_id) if scoped else query

    state = db.execute(
        scope(select(BedState), BedState).order_by(BedState.timestamp_utc.desc()).limit(1)
    ).scalar_one_or_none()
    last_event = db.execute(
        scope(select(Event), Event).order_by(Event.timestamp_utc.desc()).limit(1)
    ).scalar_one_or_none()
    last_reading = db.execute(
        scope(select(SensorReading), SensorReading)
        .order_by(SensorReading.timestamp_utc.desc())
        .limit(1)
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
        "session_id": str(scope_id) if scope_id else None,
        "session_name": runtime.current_session_name
        if scope_id == runtime.current_session_id else None,
        "scope": "session" if scoped else "all_sessions",
        "demo_mode_unscoped": not scoped,
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
