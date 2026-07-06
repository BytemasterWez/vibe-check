"""API behaviour tests with the data layer stubbed out (no database):
auth, rate limiting, request IDs, structured errors, CSV export, pagination.
Endpoint-against-real-views coverage lives in tests/integration."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("CSE_API_KEYS", "test-key")
    monkeypatch.setenv("CSE_RATE_LIMIT_PER_MINUTE", "5")

    import services.api.deps as deps
    import services.api.main as main

    fake_rows = {
        "api.source_health": [
            {"source_id": "bls_laus", "name": "BLS LAUS", "category": "labour",
             "lifecycle_status": "PRODUCTION_ALLOWED"}],
        "api.county_profile": [
            {"county_fips": "22103", "state_fips": "22", "state_abbr": "LA",
             "state_name": "Louisiana", "county_name": "St. Tammany",
             "county_type": "parish", "county_equivalent_name": "St. Tammany Parish",
             "land_area": 1.0, "water_area": 1.0, "centroid_geojson": None,
             "is_active": True}],
        "api.county_signal_pack": [
            {"county_fips": "22103", "variable_id": "bls_laus_unemployment_rate",
             "variable_name": "Unemployment rate", "time_grain": "month",
             "latest_period": "2025-12-01", "latest_value": 7.4, "unit": "percent",
             "source_id": "bls_laus", "confidence": "MATCH_EXACT_FIPS"}],
        "api.county_scores": [],
        "SELECT 1": [{"ok": 1}],
    }

    def fake_query_rows(sql: str, **params):
        for token, rows in fake_rows.items():
            if token in sql:
                if token == "api.county_profile" and "f" in params:
                    return [r for r in rows if r["county_fips"] == params["f"]]
                return rows
        return []

    monkeypatch.setattr(deps, "query_rows", fake_query_rows)
    monkeypatch.setattr(main, "query_rows", fake_query_rows)
    monkeypatch.setattr(deps, "log_usage", lambda *a, **k: None)
    monkeypatch.setattr(main, "log_usage", lambda *a, **k: None)
    deps._windows.clear()
    return TestClient(main.app)


def test_health_open_and_ready(client):
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json()["status"] == "READY"


def test_version_open(client):
    assert client.get("/version").json()["api_version"] == "v1"


def test_v1_requires_api_key(client):
    resp = client.get("/v1/sources")
    assert resp.status_code == 401
    body = resp.json()
    assert body["error"] == "invalid_api_key"
    assert body["request_id"]


def test_v1_accepts_valid_key_and_sets_request_id(client):
    resp = client.get("/v1/sources", headers={"X-API-Key": "test-key"})
    assert resp.status_code == 200
    assert resp.headers["X-Request-ID"]
    assert resp.json()["sources"][0]["source_id"] == "bls_laus"


def test_rate_limit_enforced(client):
    headers = {"X-API-Key": "test-key"}
    statuses = [client.get("/v1/sources", headers=headers).status_code for _ in range(7)]
    assert 429 in statuses
    assert statuses[:5] == [200] * 5


def test_county_profile_shape(client):
    resp = client.get("/v1/counties/22103/profile", headers={"X-API-Key": "test-key"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["county"]["county_fips"] == "22103"
    assert body["signals"][0]["variable_id"] == "bls_laus_unemployment_rate"


def test_unknown_county_is_structured_404(client):
    resp = client.get("/v1/counties/99999", headers={"X-API-Key": "test-key"})
    assert resp.status_code == 404
    assert resp.json()["error"] == "county_not_found"


def test_csv_export(client):
    resp = client.get("/v1/counties/22103/variables?format=csv",
                      headers={"X-API-Key": "test-key"})
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/csv")
    assert "bls_laus_unemployment_rate" in resp.text


def test_bad_provenance_record_id_is_422(client):
    resp = client.get("/v1/provenance/not-a-record-id",
                      headers={"X-API-Key": "test-key"})
    assert resp.status_code == 422
    assert resp.json()["error"] == "bad_record_id"
