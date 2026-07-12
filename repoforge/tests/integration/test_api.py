from fastapi.testclient import TestClient

from app.config import Settings, get_settings
from app.main import app, get_config


def _client(settings: Settings | None = None) -> TestClient:
    if settings is not None:
        app.dependency_overrides[get_config] = lambda: settings
    return TestClient(app)


def teardown_function():
    app.dependency_overrides.clear()


def test_health_ok():
    r = _client().get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_readiness_reports_not_ready_without_db():
    # No database is available in unit CI, so readiness should be 503, not crash.
    r = _client().get("/ready")
    assert r.status_code == 503
    body = r.json()
    assert body["ready"] is False
    assert body["database"]["ok"] is False
    assert any(c["name"] == "postgres_filesystem" for c in body["preflight"])


def test_config_endpoint_redacts_secrets():
    settings = Settings(github_token="secret", admin_token="tok", postgres_password="pw")
    r = _client(settings).get("/api/config")
    assert r.status_code == 200
    flat = str(r.json())
    assert "secret" not in flat
    assert "pw" not in flat
    assert r.json()["github_configured"] is True


def test_dashboard_renders_html():
    r = _client().get("/")
    assert r.status_code == 200
    assert "text/html" in r.headers["content-type"]
    assert "RepoForge" in r.text


def test_mutation_requires_admin_token():
    settings = Settings(admin_token="s3cret")
    client = _client(settings)
    assert client.post("/api/rescan").status_code == 401
    assert client.post("/api/rescan", headers={"X-Admin-Token": "wrong"}).status_code == 401
    # A valid token gets past auth. With no DB in unit CI the rescan itself
    # returns 503, but crucially it is NOT rejected as 401.
    assert client.post("/api/rescan", headers={"X-Admin-Token": "s3cret"}).status_code != 401


def test_feedback_validates_label():
    settings = Settings(admin_token="s3cret")
    client = _client(settings)
    hdr = {"X-Admin-Token": "s3cret"}
    ok = client.post("/api/feedback", headers=hdr, json={"label": "interesting"})
    bad = client.post("/api/feedback", headers=hdr, json={"label": "bogus"})
    assert ok.status_code == 200
    assert bad.status_code == 422


def test_mutation_blocked_when_admin_token_unset():
    settings = Settings(admin_token="")
    r = _client(settings).post("/api/rescan")
    assert r.status_code == 503


def teardown_module():
    get_settings.cache_clear()
