# MagLab Deployment

## iOS app

See `ios/README.md`. Generate the Xcode project with XcodeGen (or create
it manually), build to a device with your development team, grant location
and motion permissions. The app is fully functional with no backend.

## Backend (Phase 7 — skeleton today)

Requirements: Docker + Docker Compose.

```bash
cd maglab/backend
docker compose up --build
```

This starts:

- `db` — PostGIS 16 (port 5432, volume `maglab-pgdata`),
- `api` — FastAPI/uvicorn (port 8000).

Verify: `curl http://localhost:8000/health`.

When Phase 7 lands, first-run setup will be:

1. `docker compose up -d db`
2. `alembic upgrade head` (creates the PostGIS extension and all tables)
3. Generate an admin token and contributor invite codes (script TBD;
   only hashes are stored in `contributors`).
4. `docker compose up -d api`
5. In the iPhone app Settings: enter backend URL + invite code, choose a
   sharing mode and upload mode.

## Configuration

| Variable | Default | Used by |
|---|---|---|
| `DATABASE_URL` | `postgresql+psycopg://maglab:maglab@localhost:5432/maglab` | api |
| `POSTGRES_USER/PASSWORD/DB` | `maglab` | db |

Change the Postgres password before exposing anything beyond localhost,
put the API behind TLS (reverse proxy), and restrict `/admin/*` to the
admin token. Contributor data is pseudonymous but position traces are
sensitive — treat the database as confidential.

## Analysis workstation (Phase 9)

```bash
cd maglab/analysis
python scripts/pull_backend_to_duckdb.py --backend-url https://... --admin-token ...
```

Outputs land in `data/` (DuckDB) and `data/exports/` (Parquet/CSV/GeoJSON).
Scripts are stubs until Phase 9.
