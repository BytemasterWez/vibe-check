"""Admin routes (Phase 7) — admin token required on every route.

GET /admin/stats                  — contributor/survey/sample counts
GET /admin/export/csv             — database-ready CSV export
GET /admin/export/geojson         — anomaly + track GeoJSON export
GET /admin/export/parquet         — Parquet export for DuckDB/analysis
GET /admin/export/survey_package  — full survey package re-export
"""

from fastapi import APIRouter, HTTPException

router = APIRouter()

NOT_BUILT = HTTPException(status_code=501, detail="Implemented in Phase 7 — see docs/API_SPEC.md")


@router.get("/stats")
async def stats():
    raise NOT_BUILT


@router.get("/export/csv")
async def export_csv():
    raise NOT_BUILT


@router.get("/export/geojson")
async def export_geojson():
    raise NOT_BUILT


@router.get("/export/parquet")
async def export_parquet():
    raise NOT_BUILT


@router.get("/export/survey_package")
async def export_survey_package():
    raise NOT_BUILT
