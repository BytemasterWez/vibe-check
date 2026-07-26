"""Evidence reporter tests (spec §17–18)."""
import csv
import json
from datetime import datetime, timezone

from app.services.evidence_reporter import generate_evidence_pack
from app.services import experiment_logger

T0 = datetime(2026, 7, 8, 12, 0, 0, tzinfo=timezone.utc)


def sample_session():
    return {
        "id": "11111111-1111-1111-1111-111111111111",
        "name": "T005_bed_exit_5min",
        "scenario": "bed_exit",
        "operator_name": "Tester",
        "started_at": T0,
        "ended_at": T0,
        "notes": "Prototype run",
        "expected_events": ["possible_bed_exit", "bed_exit"],
        "actual_results": {
            "expected": [
                {"expected_event": "possible_bed_exit", "detected": True,
                 "detection_delay_seconds": 12.0, "occurrences": 1},
                {"expected_event": "bed_exit", "detected": True,
                 "detection_delay_seconds": 27.0, "occurrences": 1},
            ],
            "false_positive_count": 0,
            "false_positive_types": [],
            "false_negative_count": 0,
            "signal_quality_average": 0.88,
            "all_expected_detected": True,
        },
        "pass_fail": "pass",
    }


def make_pack(tmp_path):
    return generate_evidence_pack(
        tmp_path,
        session=sample_session(),
        sensors=[{"name": "Mock radar", "sensor_type": "mock_radar", "status": "mock",
                  "location": "headboard"}],
        readings=[{"timestamp_utc": T0, "sensor_type": "mock_radar",
                   "metric": "radar_motion_score", "value_float": 0.8,
                   "value_text": None, "unit": "score", "quality_score": 0.9}],
        bed_states=[{"timestamp_utc": T0, "occupied": False, "movement_state": "empty",
                     "breathing_like_detected": None, "bed_exit_risk": "low",
                     "overall_state": "exited_bed", "confidence_score": 0.85,
                     "signal_quality": "good", "explanation": "test"}],
        events=[{"timestamp_utc": T0, "event_type": "bed_exit", "severity": "medium",
                 "confidence_score": 0.85, "title": "Prototype event detected: bed exit",
                 "description": "…", "acknowledged": False}],
        risks=[{"risk_title": "Test risk", "risk_category": "technical",
                "description": "d", "possible_cause": "c", "impact": "i",
                "mitigation": "m", "status": "open"}],
        now=T0,
    )


def test_markdown_report_content_and_filename(tmp_path):
    pack = make_pack(tmp_path)
    md_path = pack["markdown_path"]
    assert "bedsense_v0_report_20260708_120000.md" in md_path
    text = open(md_path).read()
    assert text.startswith("# CableLight BedSense V0 Evidence Report")
    for heading in (
        "Prototype Boundary Statement", "Session Summary", "Sensors Used",
        "Expected Events", "Actual Events", "Detection Results",
        "False Positives", "False Negatives", "Unscoped Events",
        "Signal Quality Summary", "Event Timeline", "Risk Register Snapshot",
        "Screenshots", "Conclusion", "Next Validation Steps",
    ):
        assert f"## {heading}" in text
    assert "non-clinical research demonstrator" in text.lower()
    assert "| bed_exit | yes | 27.0 | 1 |" in text
    # V0.1 §4: fusion confidence must be qualified, never read as accuracy.
    assert "fusion confidence is an internal prototype scoring measure" in text.lower()
    assert "Operator final assessment:" in text
    assert "Fusion confidence |" in text  # event timeline column header


def test_csv_exports_written_with_session_id(tmp_path):
    pack = make_pack(tmp_path)
    assert set(pack["csv_paths"]) == {
        "sensor_readings", "bed_states", "events", "experiment_summary", "risk_register",
    }
    for name, path in pack["csv_paths"].items():
        with open(path) as f:
            rows = list(csv.DictReader(f))
        assert rows, f"{name} export is empty"
        assert "session_id" in rows[0], f"{name} export missing session_id"
        assert rows[0]["session_id"] == "11111111-1111-1111-1111-111111111111"


def test_json_summary(tmp_path):
    pack = make_pack(tmp_path)
    data = json.loads(open(pack["json_path"]).read())
    assert data["summary"]["scenario"] == "bed_exit"
    assert data["summary"]["false_positive_count"] == 0
    assert "non-clinical" in data["summary"]["boundary_statement"].lower()


def test_experiment_logger_results():
    events = [
        {"event_type": "possible_bed_exit", "timestamp_utc": T0.replace(second=12)},
        {"event_type": "bed_exit", "timestamp_utc": T0.replace(second=27)},
        {"event_type": "movement_detected", "timestamp_utc": T0.replace(second=11)},
    ]
    results = experiment_logger.compute_results(
        "bed_exit", ["possible_bed_exit", "bed_exit"], events, T0, [0.9, 0.86],
    )
    assert results["false_negative_count"] == 0
    assert results["false_positive_count"] == 0  # movement is expected support for bed_exit
    assert results["expected"][0]["detection_delay_seconds"] == 12.0
    assert results["signal_quality_average"] == 0.88
    assert experiment_logger.suggest_pass_fail(results) == "pass"


def test_experiment_logger_false_negative_and_positive():
    events = [{"event_type": "sensor_conflict", "timestamp_utc": T0}]
    results = experiment_logger.compute_results(
        "empty_bed", ["bed_empty"], events, T0, None,
    )
    assert results["false_negative_count"] == 1
    assert results["false_positive_count"] == 1
    assert results["false_positive_types"] == ["sensor_conflict"]
    assert experiment_logger.suggest_pass_fail(results) == "fail"
