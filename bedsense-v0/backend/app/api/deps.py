"""Shared API dependencies.

V0.1 session enforcement (§1): no reading, state or event may exist without a
session_id. Manual writes must either name a session explicitly or fall back
to the runtime's currently active session.
"""
import uuid

from fastapi import HTTPException
from sqlalchemy.orm import Session

from ..models import ExperimentSession
from ..worker import runtime


def require_session(session_id: uuid.UUID | None, db: Session) -> uuid.UUID:
    """Resolve the session a manual write belongs to, or reject the write."""
    resolved = session_id or runtime.current_session_id
    if resolved is None:
        raise HTTPException(
            422,
            "session_id is required: no experiment session is active. Start a "
            "session via POST /experiments/start (or run a demo) first.",
        )
    if db.get(ExperimentSession, resolved) is None:
        raise HTTPException(404, f"Experiment session {resolved} not found")
    return resolved
