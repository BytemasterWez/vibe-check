from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from ..adapters.mock_adapter import MOCK_SCENARIOS
from ..config import settings
from ..database import get_db
from ..models import BedState, Event, EvidenceReport, ExperimentSession, SensorReading
from ..services.experiment_logger import finalize_experiment
from ..worker import runtime

router = APIRouter(prefix="/mock", tags=["mock"])
demo_router = APIRouter(prefix="/demo", tags=["demo"])


class MockScenarioBody(BaseModel):
    scenario: str = "empty_bed"
    speed: str = "realtime"
    csv_file: str | None = None


class DemoResetBody(BaseModel):
    delete_reports: bool = False


class DemoRunBody(BaseModel):
    scenario: str
    speed: str = "fast"
    operator_name: str | None = None


# One-click demo sequences (V0.1 §7). Each auto-creates its own session via
# the runtime and finishes on its own, leaving a report-ready run.
DEMO_SEQUENCES = {
    "empty_bed": "Empty bed demo",
    "person_enters_bed": "Person enters bed demo",
    "person_still": "Still breathing-like demo",
    "person_moving": "Movement demo",
    "bed_exit": "Bed-exit demo",
    "mixed_sequence": "Full mixed sequence demo",
}


@router.post("/start")
def start_mock():
    if not settings.enable_mock_sensor:
        raise HTTPException(403, "Mock sensor is disabled (ENABLE_MOCK_SENSOR=false)")
    return runtime.start_mock(scenario=runtime.scenario or "empty_bed", speed=runtime.speed)


@router.post("/stop")
def stop_mock():
    return runtime.stop_mock()


@router.post("/scenario")
def set_scenario(body: MockScenarioBody):
    if not settings.enable_mock_sensor:
        raise HTTPException(403, "Mock sensor is disabled (ENABLE_MOCK_SENSOR=false)")
    try:
        return runtime.start_mock(scenario=body.scenario, speed=body.speed, csv_file=body.csv_file)
    except (ValueError, FileNotFoundError) as exc:
        raise HTTPException(400, str(exc))


@router.get("/status")
def mock_status():
    return {**runtime.status(), "available_scenarios": MOCK_SCENARIOS + ["csv_replay"]}


@demo_router.get("/sequences")
def list_demo_sequences():
    return [
        {"scenario": scenario, "label": label}
        for scenario, label in DEMO_SEQUENCES.items()
    ]


@demo_router.post("/run")
def run_demo(body: DemoRunBody):
    """Start a one-click demo: auto-creates a session, runs the scenario to
    completion, then finalizes results so the run is report-ready.
    """
    if not settings.enable_mock_sensor:
        raise HTTPException(403, "Mock sensor is disabled (ENABLE_MOCK_SENSOR=false)")
    if body.scenario not in DEMO_SEQUENCES:
        raise HTTPException(400, f"Unknown demo scenario. Choose from {list(DEMO_SEQUENCES)}")
    if runtime.current_session_id is not None and not runtime.auto_session:
        raise HTTPException(
            409,
            "An operator experiment session is running. Stop it before running a demo.",
        )
    status = runtime.start_mock(scenario=body.scenario, speed=body.speed)
    return {
        "demo": DEMO_SEQUENCES[body.scenario],
        "note": "Demo runs to completion, then finalizes its own session with results.",
        **status,
    }


@demo_router.post("/reset")
def reset_demo(body: DemoResetBody | None = None, db: Session = Depends(get_db)):
    """Reset demo state: stop the mock, close any open sessions, and remove
    orphan (unscoped) data left over from before session enforcement.

    Session-scoped readings/states/events are kept (archived under their
    ended sessions, hidden from the current-session dashboard view).
    Evidence reports are only deleted when explicitly requested.
    """
    body = body or DemoResetBody()
    runtime.stop_mock()

    open_sessions = db.execute(
        select(ExperimentSession).where(ExperimentSession.ended_at.is_(None))
    ).scalars().all()
    for session in open_sessions:
        runtime.unbind_session(session.id)
        finalize_experiment(db, session)

    orphans = {
        "readings": db.execute(
            delete(SensorReading).where(SensorReading.session_id.is_(None))
        ).rowcount,
        "bed_states": db.execute(
            delete(BedState).where(BedState.session_id.is_(None))
        ).rowcount,
        "events": db.execute(
            delete(Event).where(Event.session_id.is_(None))
        ).rowcount,
    }

    reports_deleted = 0
    if body.delete_reports:
        for report in db.execute(select(EvidenceReport)).scalars().all():
            for path in [report.markdown_path, report.json_path,
                         *(report.csv_paths or {}).values()]:
                if path and Path(path).exists():
                    Path(path).unlink()
            db.delete(report)
            reports_deleted += 1

    db.commit()
    return {
        "reset_at": datetime.now(timezone.utc),
        "sessions_closed": len(open_sessions),
        "orphan_rows_deleted": orphans,
        "reports_deleted": reports_deleted,
        "mock": runtime.status(),
    }
