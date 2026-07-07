"""MagLab backend — FastAPI service (Phase 7 skeleton).

The brief's build order gate applies: this backend is implemented AFTER
Phases 1-3 are verified on a real iPhone. The structure, schema contract
(models.py, schemas.py) and route surface (routers/) are laid out now so
the iOS sync client and this service converge on the same API.

Currently live: GET /health. All other routes return 501 until Phase 7.
"""

from fastapi import FastAPI

from . import auth
from .routers import admin, exports, markers, samples, surveys

app = FastAPI(
    title="MagLab Backend",
    description="Signal-of-Opportunity Field Network — survey ingest and export API",
    version="0.1.0",
)

app.include_router(auth.router, prefix="/auth", tags=["auth"])
app.include_router(surveys.router, prefix="/surveys", tags=["surveys"])
app.include_router(samples.router, prefix="/samples", tags=["samples"])
app.include_router(markers.router, prefix="/markers", tags=["markers"])
app.include_router(exports.router, prefix="/anomalies", tags=["anomalies"])
app.include_router(admin.router, prefix="/admin", tags=["admin"])


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "service": "maglab-backend", "version": "0.1.0"}
