import pandas as pd
import pytest

from engine.contracts import EventContract
from engine.events.engine import build_case_control_set, detect_occurrences


def make_event(**overrides) -> EventContract:
    data = {
        "event_id": "unemployment_spike_2pp_12m",
        "description": "test",
        "base_variable": "bls_laus_unemployment_rate",
        "condition": {"transform": "change_12m", "operator": ">=", "threshold": 2.0},
        "time_grain": "month",
        "minimum_history_months": 0,
        **overrides,
    }
    return EventContract(**data)


def feature_frame(rows):
    return pd.DataFrame([
        {"county_fips": fips, "period": pd.Timestamp(period),
         "feature_id": "bls_laus_unemployment_rate__change_12m", "feature_value": val}
        for fips, period, val in rows
    ])


def test_detect_occurrences_threshold():
    fm = feature_frame([
        ("22103", "2025-06-01", 2.5),    # hit
        ("48201", "2025-06-01", 1.9),    # miss
        ("01073", "2025-06-01", 2.0),    # boundary: >= hits
        ("02020", "2025-06-01", None),   # null: never a hit
    ])
    occ = detect_occurrences(make_event(), fm)
    assert {(o.county_fips, o.trigger_value) for o in occ} == {("22103", 2.5), ("01073", 2.0)}


def test_detect_occurrences_missing_feature_raises():
    fm = feature_frame([("22103", "2025-06-01", 2.5)])
    fm["feature_id"] = "some_other_feature"
    with pytest.raises(ValueError, match="not present"):
        detect_occurrences(make_event(), fm)


def test_minimum_history_enforced():
    fm = feature_frame([("22103", "2025-06-01", 3.0)])
    obs = pd.DataFrame([{
        "county_fips": "22103", "period": pd.Timestamp("2025-01-01"),
        "variable_id": "bls_laus_unemployment_rate", "value": 5.0,
    }])
    event = make_event(minimum_history_months=12)
    assert detect_occurrences(event, fm, obs) == []   # only 5 months of history
    obs_old = obs.assign(period=pd.Timestamp("2023-01-01"))
    assert len(detect_occurrences(event, fm, obs_old)) == 1


def test_case_control_set_excludes_event_counties_from_controls():
    rows = [("22103", "2025-06-01", 2.5), ("22071", "2025-07-01", 2.2)]
    rows += [(f"48{i:03d}", "2025-06-01", 0.1) for i in range(1, 30)]
    rows += [(f"48{i:03d}", "2025-07-01", 0.1) for i in range(1, 30)]
    fm = feature_frame(rows)
    event = make_event()
    occ = detect_occurrences(event, fm)
    cc = build_case_control_set(event, occ, fm)
    case_fips = {c["county_fips"] for c in cc.cases}
    control_fips = {c["county_fips"] for c in cc.controls}
    assert case_fips == {"22103", "22071"}
    assert not case_fips & control_fips
    assert cc.diagnostics()["case_count"] == 2
    assert cc.diagnostics()["control_count"] > 0


def test_case_control_first_occurrence_per_county():
    fm = feature_frame([
        ("22103", "2025-05-01", 2.1),
        ("22103", "2025-06-01", 2.9),   # same county, later — not a second case
        ("48001", "2025-05-01", 0.0),
    ])
    event = make_event()
    occ = detect_occurrences(event, fm)
    cc = build_case_control_set(event, occ, fm)
    assert len(cc.cases) == 1
    assert cc.cases[0]["period"] == "2025-05-01"
