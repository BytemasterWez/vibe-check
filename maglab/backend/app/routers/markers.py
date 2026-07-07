"""Marker routes (Phase 7).

POST /markers/bulk        — batch ingest (idempotent by marker UUID)
GET  /markers?survey_id=  — markers for a survey
"""

import uuid

from fastapi import APIRouter, HTTPException

router = APIRouter()

NOT_BUILT = HTTPException(status_code=501, detail="Implemented in Phase 7 — see docs/API_SPEC.md")


@router.post("/bulk")
async def upload_markers_bulk():
    raise NOT_BUILT


@router.get("")
async def list_markers(survey_id: uuid.UUID):
    raise NOT_BUILT
