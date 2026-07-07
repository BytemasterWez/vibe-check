"""Anomaly event routes (Phase 7).

POST /anomalies/bulk        — batch ingest (idempotent by event UUID)
GET  /anomalies?survey_id=  — anomaly events for a survey
"""

import uuid

from fastapi import APIRouter, HTTPException

router = APIRouter()

NOT_BUILT = HTTPException(status_code=501, detail="Implemented in Phase 7 — see docs/API_SPEC.md")


@router.post("/bulk")
async def upload_anomalies_bulk():
    raise NOT_BUILT


@router.get("")
async def list_anomalies(survey_id: uuid.UUID):
    raise NOT_BUILT
