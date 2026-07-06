# Deployment

## Local / single host (Docker Compose)

```bash
cp .env.example .env                     # set real secrets
docker compose up -d --build
docker compose exec api python -m scripts.migrate
docker compose exec api python -m scripts.seed_ref     # downloads Census Gazetteer (3,144 counties)
make sample-pipeline                     # offline end-to-end proof on bundled fixtures
```

Then, for real data:

```bash
docker compose exec api python -m scripts.run_pipeline --source bls_laus --mode full
docker compose exec api python -m scripts.run_pipeline --source census_acs --mode full --param year=2023
docker compose exec api python -m scripts.run_pipeline --source fema_nri --mode full
docker compose exec api python -m scripts.run_features
docker compose exec api python -m scripts.run_event --event unemployment_spike_2pp_12m
docker compose exec api python -m scripts.run_experiment --event unemployment_spike_2pp_12m
docker compose exec api python -m scripts.run_scoring --recipe labour_shock_monitor
```

The scheduler + worker keep sources fresh after that (schedules derive
from each contract's `update_frequency`).

## Geometry (optional but recommended)

`ref.counties` works without PostGIS (portable centroid lat/lon). For
boundary polygons, install PostGIS (the compose image ships it) and load
TIGER/Line county shapefiles (`tl_2023_us_county.zip`) with `shp2pgsql` or
`ogr2ogr` into `ref.counties.geometry`. The API's `centroid_geojson` works
either way.

## Cloud

- Postgres: RDS/Cloud SQL with the PostGIS extension. Point
  `CSE_DATABASE_URL` (read-write) and `CSE_API_DATABASE_URL` (the
  `countysignal_api_ro` role) at it.
- Object storage: set `CSE_OBJECT_STORE=s3` with real S3 credentials
  (drop the MinIO service).
- Run `api` behind TLS with per-customer API keys in `CSE_API_KEYS`
  (comma-separated) or a secrets manager.
- One `worker` per queue is enough for Milestone 1 volumes; scale
  horizontally later (jobs are idempotent, so at-least-once delivery is
  safe).

## Backup & restore (commercial-readiness requirement)

- `pg_dump -Fc countysignal` nightly + object-store versioning on the raw
  bucket. Because raw artifacts are immutable and content-addressed, a
  restore of Postgres + the raw bucket reproduces the entire system; every
  derived table can also be rebuilt from contracts + raw artifacts alone.
- Test the restore path before external sale: restore into a scratch
  database, run `pytest tests/integration -m integration` against it.

## Environments without network access

`scripts/seed_ref.py --fixture` seeds a 64-county subset and every adapter
has a `sample` mode reading bundled fixtures, so the full pipeline —
ingestion through scorecard CSV — runs with zero network access
(that is exactly what CI and the integration test do).
