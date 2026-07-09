from fastapi.testclient import TestClient
from sqlalchemy import select

from app.api.main import app
from app.db import session
from app.models import Profile
from app.workers.ingest import rescore_all, run_source


def seeded_client(cf_releases) -> TestClient:
    run_source("contracts_finder", releases_override=cf_releases)
    with session() as db:
        db.add(Profile(name="all", keywords=[], cpv_prefixes=[], min_days_to_deadline=0))
    rescore_all()
    return TestClient(app)


def test_health_reports_runs_and_counts(fresh_db, cf_releases):
    client = seeded_client(cf_releases)
    body = client.get("/health").json()
    assert body["status"] == "ok"
    assert body["notices"] == 3
    assert body["last_runs"]["contracts_finder"]["status"] == "ok"


def test_notices_endpoint(fresh_db, cf_releases):
    client = seeded_client(cf_releases)
    rows = client.get("/notices").json()
    assert len(rows) == 3
    assert all(r["ocid"].startswith("ocds-") for r in rows)


def test_digest_and_csv_export(fresh_db, cf_releases):
    client = seeded_client(cf_releases)
    with session() as db:
        profile_id = db.scalar(select(Profile.id))
    digest = client.get(f"/matches/{profile_id}", params={"min_score": 0})
    assert digest.status_code == 200
    assert "TenderPulse digest" in digest.text
    csv_resp = client.get(f"/matches/{profile_id}/export.csv", params={"min_score": 0})
    assert csv_resp.status_code == 200
    assert csv_resp.text.splitlines()[0].startswith("score,title,buyer")
    assert len(csv_resp.text.splitlines()) == 4  # header + 3 notices


def test_digest_missing_profile_404(fresh_db, cf_releases):
    client = seeded_client(cf_releases)
    assert client.get("/matches/999").status_code == 404


def test_create_profile_and_dashboard(fresh_db, cf_releases):
    client = seeded_client(cf_releases)
    created = client.post("/profiles", json={"name": "media", "keywords": ["filming"]})
    assert created.status_code == 200
    page = client.get("/")
    assert page.status_code == 200
    assert "TenderPulse" in page.text
