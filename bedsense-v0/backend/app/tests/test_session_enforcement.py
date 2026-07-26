"""Session enforcement and session-scoped query tests (V0.1 §1, §2).

Runs the real FastAPI app against a temporary SQLite database so the tests
cover the routes, the runtime binding and the ORM together.
"""
import os
import tempfile

import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def client(monkeypatch):
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    os.environ["DATABASE_URL"] = f"sqlite:///{tmp.name}"

    # Import after DATABASE_URL is set so the engine binds to the temp file.
    for module in list(os.sys.modules):
        if module.startswith("app."):
            del os.sys.modules[module]
    from app.main import app
    from app.worker import runtime

    runtime.mock_running = False
    runtime.current_session_id = None
    runtime.current_session_name = None
    runtime.auto_session = False

    with TestClient(app) as c:
        c.runtime = runtime  # type: ignore[attr-defined]
        yield c

    os.unlink(tmp.name)
    os.environ.pop("DATABASE_URL", None)


def start_session(client, name="T001_test", scenario="person_still"):
    res = client.post("/experiments/start", json={"name": name, "scenario": scenario})
    assert res.status_code == 201, res.text
    return res.json()["id"]


# ---- §1 session enforcement ------------------------------------------------

def test_reading_without_session_is_rejected(client):
    res = client.post("/readings", json={
        "sensor_type": "mock_radar", "metric": "radar_motion_score", "value_float": 0.5,
    })
    assert res.status_code == 422
    assert "session" in res.json()["detail"].lower()


def test_event_without_session_is_rejected(client):
    res = client.post("/events", json={"event_type": "manual_note", "severity": "info"})
    assert res.status_code == 422


def test_bulk_readings_without_session_are_rejected(client):
    res = client.post("/readings/bulk", json={"readings": [
        {"sensor_type": "mock_radar", "metric": "radar_motion_score", "value_float": 0.5},
    ]})
    assert res.status_code == 422


def test_writes_inherit_active_session(client):
    session_id = start_session(client)
    res = client.post("/readings", json={
        "sensor_type": "mock_radar", "metric": "radar_motion_score", "value_float": 0.5,
    })
    assert res.status_code == 201
    assert res.json()["session_id"] == session_id

    res = client.post("/events", json={"event_type": "manual_note", "severity": "info"})
    assert res.status_code == 201
    assert res.json()["session_id"] == session_id


def test_write_to_unknown_session_is_rejected(client):
    start_session(client)
    res = client.post("/readings", json={
        "session_id": "11111111-2222-3333-4444-555555555555",
        "sensor_type": "mock_radar", "metric": "radar_motion_score", "value_float": 0.5,
    })
    assert res.status_code == 404


def test_mock_start_auto_creates_demo_session(client):
    assert client.get("/mock/status").json()["session_id"] is None
    res = client.post("/mock/scenario", json={"scenario": "person_still", "speed": "fast"})
    assert res.status_code == 200
    status = res.json()
    assert status["session_id"] is not None
    assert status["auto_session"] is True
    assert status["session_name"].startswith("DEMO_person_still_")

    listed = client.get("/experiments").json()
    assert any(s["name"].startswith("DEMO_person_still_") for s in listed)
    client.post("/mock/stop")


def test_stopping_mock_finalizes_demo_session(client):
    client.post("/mock/scenario", json={"scenario": "person_still", "speed": "fast"})
    session_id = client.get("/mock/status").json()["session_id"]
    client.post("/mock/stop")

    assert client.get("/mock/status").json()["session_id"] is None
    session = client.get(f"/experiments/{session_id}").json()
    assert session["ended_at"] is not None
    assert session["actual_results"] is not None
    assert session["actual_results"]["unscoped_events_count"] == 0


def test_mock_restart_rolls_into_fresh_demo_session(client):
    client.post("/mock/scenario", json={"scenario": "person_still", "speed": "fast"})
    first = client.get("/mock/status").json()["session_id"]
    client.post("/mock/scenario", json={"scenario": "bed_exit", "speed": "fast"})
    second = client.get("/mock/status").json()["session_id"]
    assert first != second
    assert client.get(f"/experiments/{first}").json()["ended_at"] is not None
    client.post("/mock/stop")


def test_operator_session_is_not_replaced_by_demo(client):
    session_id = start_session(client, name="T003_operator")
    client.post("/mock/scenario", json={"scenario": "person_still", "speed": "fast"})
    status = client.get("/mock/status").json()
    assert status["session_id"] == session_id
    assert status["auto_session"] is False
    # a one-click demo must refuse to hijack an operator session
    assert client.post("/demo/run", json={"scenario": "person_still"}).status_code == 409
    client.post("/mock/stop")


# ---- §2 session-scoped dashboard queries -----------------------------------

def test_current_state_defaults_to_active_session(client):
    old = start_session(client, name="T_old", scenario="bed_exit")
    client.post("/events", json={"event_type": "bed_exit", "severity": "medium"})
    client.post(f"/experiments/{old}/stop")

    new = start_session(client, name="T_new", scenario="person_still")
    client.post("/events", json={"event_type": "breathing_like_detected", "severity": "info"})

    scoped = client.get("/state/current").json()
    assert scoped["session_id"] == new
    assert scoped["scope"] == "session"
    assert scoped["demo_mode_unscoped"] is False
    # the stale bed_exit from the previous session must not leak in
    assert scoped["last_event"]["event_type"] == "breathing_like_detected"


def test_current_state_all_sessions_toggle(client):
    old = start_session(client, name="T_old", scenario="bed_exit")
    client.post("/events", json={"event_type": "bed_exit", "severity": "medium"})
    client.post(f"/experiments/{old}/stop")

    unscoped = client.get("/state/current?all_sessions=true").json()
    assert unscoped["scope"] == "all_sessions"
    assert unscoped["demo_mode_unscoped"] is True
    assert unscoped["last_event"]["event_type"] == "bed_exit"


def test_events_filter_by_session(client):
    first = start_session(client, name="T_a", scenario="bed_exit")
    client.post("/events", json={"event_type": "bed_exit", "severity": "medium"})
    client.post(f"/experiments/{first}/stop")
    second = start_session(client, name="T_b", scenario="person_still")
    client.post("/events", json={"event_type": "breathing_like_detected", "severity": "info"})

    scoped = client.get(f"/events?session_id={second}").json()
    assert [e["event_type"] for e in scoped] == ["breathing_like_detected"]
    assert len(client.get("/events").json()) == 2


# ---- §5 demo reset / §7 demo sequences -------------------------------------

def test_demo_reset_closes_sessions_and_keeps_reports(client):
    session_id = start_session(client, name="T_reset")
    client.post("/events", json={"event_type": "manual_note", "severity": "info"})

    res = client.post("/demo/reset", json={"delete_reports": False})
    assert res.status_code == 200
    body = res.json()
    assert body["sessions_closed"] == 1
    assert body["reports_deleted"] == 0
    assert client.get(f"/experiments/{session_id}").json()["ended_at"] is not None
    # session-scoped data is archived, not deleted
    assert len(client.get(f"/events?session_id={session_id}").json()) == 1
    assert client.get("/mock/status").json()["session_id"] is None


def test_demo_sequences_listed(client):
    sequences = client.get("/demo/sequences").json()
    labels = {s["scenario"] for s in sequences}
    assert labels == {
        "empty_bed", "person_enters_bed", "person_still",
        "person_moving", "bed_exit", "mixed_sequence",
    }


def test_demo_run_creates_session(client):
    res = client.post("/demo/run", json={"scenario": "bed_exit", "speed": "fast"})
    assert res.status_code == 200
    body = res.json()
    assert body["demo"] == "Bed-exit demo"
    assert body["auto_session"] is True
    assert body["session_name"].startswith("DEMO_bed_exit_")
    client.post("/mock/stop")


# ---- §6 evidence pack must match exactly one session -----------------------

def test_evidence_pack_rejects_running_session(client):
    session_id = start_session(client, name="T_running")
    res = client.post("/reports/evidence-pack", json={"session_id": session_id})
    assert res.status_code == 409


def test_evidence_pack_scoped_to_one_session(client, tmp_path):
    from app.config import settings
    settings.evidence_dir = str(tmp_path)

    other = start_session(client, name="T_other", scenario="bed_exit")
    client.post("/events", json={"event_type": "bed_exit", "severity": "medium"})
    client.post(f"/experiments/{other}/stop")

    target = start_session(client, name="T_target", scenario="person_still")
    client.post("/events", json={"event_type": "breathing_like_detected", "severity": "info"})
    client.post(f"/experiments/{target}/stop")

    res = client.post("/reports/evidence-pack", json={"session_id": target})
    assert res.status_code == 201
    report = res.json()
    assert report["summary"]["session_id"] == target
    assert report["summary"]["events_count"] == 1
    assert report["summary"]["unscoped_events_count"] == 0

    markdown = open(report["markdown_path"]).read()
    assert "T_target" in markdown
    assert "bed_exit" not in markdown.split("## Event Timeline")[1]
    assert "fusion confidence is an internal prototype scoring measure" in markdown.lower()
