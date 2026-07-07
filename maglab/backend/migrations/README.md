# Migrations

Alembic migrations live here from Phase 7. The initial migration will:

1. `CREATE EXTENSION IF NOT EXISTS postgis;`
2. Create all tables defined in `app/models.py` (contributors, surveys,
   survey_runs, sensor_samples, survey_markers, anomaly_events,
   sync_batches, export_jobs, anomaly_labels).
3. Add the indexes listed on `sensor_samples`, including the GIST index
   on `geom`.
