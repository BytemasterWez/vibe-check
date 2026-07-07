"""Sensor sample routes (Phase 7).

POST /samples/bulk        — batch ingest (idempotent by sample UUID)
GET  /samples?survey_id=  — samples for a survey
"""

import uuid

from fastapi import APIRouter, HTTPException

router = APIRouter()

NOT_BUILT = HTTPException(status_code=501, detail="Implemented in Phase 7 — see docs/API_SPEC.md")


@router.post("/bulk")
async def upload_samples_bulk():
    raise NOT_BUILT


@router.get("")
async def list_samples(survey_id: uuid.UUID):
    raise NOT_BUILT
