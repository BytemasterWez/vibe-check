import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import settings
from ..database import get_db
from ..models import (
    BedState,
    Event,
    EvidenceReport,
    ExperimentSession,
    RiskRegisterEntry,
    Sensor,
    SensorReading,
)
from ..schemas.experiment_schema import ReportOut
from ..services.evidence_reporter import generate_evidence_pack

router = APIRouter(prefix="/reports", tags=["reports"])


class EvidencePackRequest(BaseModel):
    session_id: uuid.UUID
    name: str | None = None


def _row_dicts(rows, cols):
    return [{c: getattr(r, c) for c in cols} for r in rows]


@router.post("/evidence-pack", response_model=ReportOut, status_code=201)
def create_evidence_pack(payload: EvidencePackRequest, db: Session = Depends(get_db)):
    session = db.get(ExperimentSession, payload.session_id)
    if not session:
        raise HTTPException(404, "Experiment session not found")

    readings = db.execute(
        select(SensorReading)
        .where(SensorReading.session_id == session.id)
        .order_by(SensorReading.timestamp_utc)
    ).scalars().all()
    bed_states = db.execute(
        select(BedState).where(BedState.session_id == session.id).order_by(BedState.timestamp_utc)
    ).scalars().all()
    events = db.execute(
        select(Event).where(Event.session_id == session.id).order_by(Event.timestamp_utc)
    ).scalars().all()
    risks = db.execute(select(RiskRegisterEntry).order_by(RiskRegisterEntry.created_at)).scalars().all()
    sensors = db.execute(select(Sensor)).scalars().all()

    pack = generate_evidence_pack(
        settings.evidence_dir,
        session={
            "id": str(session.id),
            "name": session.name,
            "scenario": session.scenario,
            "operator_name": session.operator_name,
            "started_at": session.started_at,
            "ended_at": session.ended_at,
            "notes": session.notes,
            "expected_events": session.expected_events,
            "actual_results": session.actual_results,
            "pass_fail": session.pass_fail,
        },
        sensors=_row_dicts(sensors, ["name", "sensor_type", "status", "location"]),
        readings=_row_dicts(
            readings,
            ["session_id", "timestamp_utc", "sensor_type", "metric", "value_float",
             "value_text", "unit", "quality_score"],
        ),
        bed_states=_row_dicts(
            bed_states,
            ["session_id", "timestamp_utc", "occupied", "movement_state",
             "breathing_like_detected", "bed_exit_risk", "overall_state",
             "confidence_score", "signal_quality", "explanation"],
        ),
        events=_row_dicts(
            events,
            ["session_id", "timestamp_utc", "event_type", "severity",
             "confidence_score", "title", "description", "acknowledged"],
        ),
        risks=_row_dicts(
            risks,
            ["risk_title", "risk_category", "description", "possible_cause",
             "impact", "mitigation", "status"],
        ),
    )

    report = EvidenceReport(
        name=payload.name or f"Evidence pack — {session.name}",
        session_id=session.id,
        markdown_path=pack["markdown_path"],
        json_path=pack["json_path"],
        csv_paths=pack["csv_paths"],
        summary=pack["summary"],
    )
    db.add(report)
    db.commit()
    db.refresh(report)
    return report


@router.get("", response_model=list[ReportOut])
def list_reports(db: Session = Depends(get_db)):
    return db.execute(
        select(EvidenceReport).order_by(EvidenceReport.created_at.desc())
    ).scalars().all()


@router.get("/{report_id}", response_model=ReportOut)
def get_report(report_id: uuid.UUID, db: Session = Depends(get_db)):
    report = db.get(EvidenceReport, report_id)
    if not report:
        raise HTTPException(404, "Report not found")
    return report


@router.get("/{report_id}/download/{kind}")
def download_report(report_id: uuid.UUID, kind: str, db: Session = Depends(get_db)):
    """kind: markdown | json | one of the CSV export names."""
    report = db.get(EvidenceReport, report_id)
    if not report:
        raise HTTPException(404, "Report not found")
    if kind == "markdown":
        path = report.markdown_path
    elif kind == "json":
        path = report.json_path
    else:
        path = (report.csv_paths or {}).get(kind)
    if not path or not Path(path).exists():
        raise HTTPException(404, f"No '{kind}' file for this report")
    return FileResponse(path, filename=Path(path).name)
