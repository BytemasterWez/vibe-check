# MagLab backend (Phase 7 — skeleton only)

FastAPI + PostgreSQL/PostGIS sync service. **Deliberately not implemented
yet**: the build brief gates backend work behind Phases 1–3 passing on a
real iPhone (see `docs/FIELD_TEST_PROTOCOL.md`).

What exists now:

- the full schema contract (`app/models.py`) mirroring the iOS models,
- upload payload schemas (`app/schemas.py`),
- the complete route surface (all Phase 7 routes return `501`),
- Docker Compose with PostGIS, and a working `GET /health`.

Run it:

```bash
cd maglab/backend
docker compose up --build
curl http://localhost:8000/health
```

Tests:

```bash
pip install -r requirements.txt
python -m pytest tests/
```

The iPhone app never requires this service — local-first is a
non-negotiable. See `docs/API_SPEC.md` for the target API.
