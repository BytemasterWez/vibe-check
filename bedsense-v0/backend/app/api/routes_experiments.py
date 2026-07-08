import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import BedState, Event, ExperimentSession
from ..schemas.experiment_schema import (
    ExperimentAssess,
    ExperimentMark,
    ExperimentOut,
    ExperimentStart,
)
from ..services import experiment_logger
from ..worker import runtime

router = APIRouter(prefix="/experiments", tags=["experiments"])

# Default expected events per scenario (spec §11) used when the operator
# doesn't declare their own.
DEFAULT_EXPECTED = {
    "empty_bed": [],
    "person_enters_bed": ["bed_entry"],
    "person_still": ["breathing_like_detected"],
    "breathing_like_motion": ["breathing_like_detected"],
    "person_moving": ["movement_detected"],
    "bed_exit": ["possible_bed_exit", "bed_exit"],
    "restless_night": ["movement_detected", "stillness_detected"],
    "mixed_sequence": ["bed_entry", "movement_detected", "bed_exit"],
}


@router.get("", response_model=list[ExperimentOut])
def list_experiments(db: Session = Depends(get_db)):
    return db.execute(
        select(ExperimentSession).order_by(ExperimentSession.started_at.desc())
    ).scalars().all()


@router.post("/start", response_model=ExperimentOut, status_code=201)
def start_experiment(payload: ExperimentStart, db: Session = Depends(get_db)):
    if runtime.current_session_id is not None:
        raise HTTPException(409, "An experiment session is already running. Stop it first.")
    expected = payload.expected_events
    if expected is None:
        expected = DEFAULT_EXPECTED.get(payload.scenario, [])
    session = ExperimentSession(
        name=payload.name,
        scenario=payload.scenario,
        operator_name=payload.operator_name,
        notes=payload.notes,
        expected_events=expected,
        started_at=datetime.now(timezone.utc),
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    runtime.current_session_id = session.id
    return session


@router.post("/{session_id}/stop", response_model=ExperimentOut)
def stop_experiment(session_id: uuid.UUID, db: Session = Depends(get_db)):
    session = db.get(ExperimentSession, session_id)
    if not session:
        raise HTTPException(404, "Experiment session not found")
    if session.ended_at is None:
        session.ended_at = datetime.now(timezone.utc)
    if runtime.current_session_id == session.id:
        runtime.current_session_id = None

    events = db.execute(
        select(Event).where(Event.session_id == session.id).order_by(Event.timestamp_utc)
    ).scalars().all()
    quality_scores = [
        s.confidence_score
        for s in db.execute(
            select(BedState).where(BedState.session_id == session.id)
        ).scalars().all()
        if s.confidence_score is not None
    ]
    results = experiment_logger.compute_results(
        session.scenario,
        session.expected_events or [],
        [{"event_type": e.event_type, "timestamp_utc": e.timestamp_utc} for e in events],
        session.started_at,
        quality_scores,
    )
    results["suggested_pass_fail"] = experiment_logger.suggest_pass_fail(results)
    session.actual_results = results
    db.commit()
    db.refresh(session)
    return session


@router.post("/{session_id}/mark", status_code=201)
def add_marker(session_id: uuid.UUID, payload: ExperimentMark, db: Session = Depends(get_db)):
    session = db.get(ExperimentSession, session_id)
    if not session:
        raise HTTPException(404, "Experiment session not found")
    event = Event(
        session_id=session.id,
        event_type="test_marker",
        severity="info",
        title=payload.title,
        description=payload.description,
        evidence={"manual": True},
    )
    db.add(event)
    db.commit()
    return {"marker_id": str(event.id)}


@router.get("/{session_id}", response_model=ExperimentOut)
def get_experiment(session_id: uuid.UUID, db: Session = Depends(get_db)):
    session = db.get(ExperimentSession, session_id)
    if not session:
        raise HTTPException(404, "Experiment session not found")
    return session


@router.patch("/{session_id}/assess", response_model=ExperimentOut)
def assess_experiment(session_id: uuid.UUID, payload: ExperimentAssess, db: Session = Depends(get_db)):
    session = db.get(ExperimentSession, session_id)
    if not session:
        raise HTTPException(404, "Experiment session not found")
    session.pass_fail = payload.pass_fail
    if payload.notes:
        session.notes = (session.notes + "\n" if session.notes else "") + payload.notes
    if payload.actual_results:
        session.actual_results = {**(session.actual_results or {}), **payload.actual_results}
    db.commit()
    db.refresh(session)
    return session
