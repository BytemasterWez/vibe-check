"""Token auth (implemented in Phase 7/8).

v1 design: the admin generates invite codes / API tokens out of band; the
app exchanges an invite code for a contributor API token via
POST /auth/activate. Only salted hashes are stored (invite_code_hash,
api_token_hash on contributors). No email/password accounts in v1 —
contributors are pseudonymous.
"""

import hashlib

from fastapi import APIRouter, Header, HTTPException

router = APIRouter()


@router.post("/activate")
async def activate():
    """Exchange an invite code for a contributor API token. Phase 7."""
    raise HTTPException(status_code=501, detail="Implemented in Phase 7 — see docs/API_SPEC.md")


@router.post("/check")
async def check():
    """Validate an API token. Phase 7."""
    raise HTTPException(status_code=501, detail="Implemented in Phase 7 — see docs/API_SPEC.md")


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


async def get_current_contributor(authorization: str | None = Header(default=None)):
    """FastAPI dependency resolving `Authorization: Bearer <token>` to a
    contributor row. Stub until Phase 7."""
    raise HTTPException(status_code=501, detail="Auth is implemented in Phase 7")


async def require_admin(authorization: str | None = Header(default=None)):
    """Admin-token gate for /admin routes. Stub until Phase 7."""
    raise HTTPException(status_code=501, detail="Auth is implemented in Phase 7")
