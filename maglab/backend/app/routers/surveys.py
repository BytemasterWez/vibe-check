"""Survey routes (Phase 7).

POST /surveys/upload      — ingest a survey package (idempotent by UUID)
GET  /surveys             — list surveys visible to the caller
GET  /surveys/{survey_id} — survey detail
"""

import uuid

from fastapi import APIRouter, HTTPException

router = APIRouter()

NOT_BUILT = HTTPException(status_code=501, detail="Implemented in Phase 7 — see docs/API_SPEC.md")


@router.post("/upload")
async def upload_survey():
    raise NOT_BUILT


@router.get("")
async def list_surveys():
    raise NOT_BUILT


@router.get("/{survey_id}")
async def get_survey(survey_id: uuid.UUID):
    raise NOT_BUILT
