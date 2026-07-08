import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import RiskRegisterEntry
from ..schemas.experiment_schema import RiskCreate, RiskOut, RiskUpdate

router = APIRouter(prefix="/risk-register", tags=["risk-register"])


@router.get("", response_model=list[RiskOut])
def list_risks(db: Session = Depends(get_db)):
    return db.execute(
        select(RiskRegisterEntry).order_by(RiskRegisterEntry.created_at)
    ).scalars().all()


@router.post("", response_model=RiskOut, status_code=201)
def create_risk(payload: RiskCreate, db: Session = Depends(get_db)):
    risk = RiskRegisterEntry(**payload.model_dump())
    db.add(risk)
    db.commit()
    db.refresh(risk)
    return risk


@router.patch("/{risk_id}", response_model=RiskOut)
def update_risk(risk_id: uuid.UUID, payload: RiskUpdate, db: Session = Depends(get_db)):
    risk = db.get(RiskRegisterEntry, risk_id)
    if not risk:
        raise HTTPException(404, "Risk not found")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(risk, key, value)
    db.commit()
    db.refresh(risk)
    return risk
