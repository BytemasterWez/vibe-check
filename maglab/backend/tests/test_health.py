from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health():
    response = client.get("/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["service"] == "maglab-backend"


def test_phase7_routes_are_stubbed_not_missing():
    # The route surface exists now so the iOS sync client can target it;
    # implementations land in Phase 7.
    for path in ["/surveys", "/samples?survey_id=00000000-0000-0000-0000-000000000000"]:
        response = client.get(path)
        assert response.status_code == 501
