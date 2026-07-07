"""Admin export generation (Phase 7).

Produces database-ready CSV, GeoJSON, Parquet and survey-package JSON from
Postgres/PostGIS for the /admin/export/* routes. Column order for the CSV
export is defined in docs/DATA_DICTIONARY.md and must match the iOS CSV
export exactly.
"""
