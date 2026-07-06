"""Full-substrate test on the bundled sample fixtures, no database and no
network: ingest three sources → normalise → features → event → experiment →
scores → scorecard CSV. This is the workflow the engine exists to support."""

from __future__ import annotations

import csv

import pandas as pd
import pytest

from adapters.base import RunContext
from adapters.registry import build_adapter
from engine.contracts import SourceStatus, load_feature_config
from engine.events.engine import build_case_control_set, detect_occurrences
from engine.experiments.engine import run_experiment
from engine.exports.csv_export import export_scorecard_csv
from engine.features.engine import build_feature_matrix, matrix_as_of
from engine.ingestion.runner import run_source_pipeline
from engine.ingestion.store import LocalArtifactStore
from engine.scoring.engine import score_counties
from engine.validation import validate_experiment

SOURCES = ["bls_laus", "census_acs", "fema_nri"]


@pytest.fixture(scope="module")
def pipeline(counties, aliases, crosswalks, tmp_path_factory):
    """Run all three sample pipelines once into a shared MemorySink."""
    from engine.ingestion.sink import MemorySink

    sink = MemorySink(counties=counties, aliases=aliases, crosswalks=crosswalks)
    store = LocalArtifactStore(tmp_path_factory.mktemp("raw"))
    results = {}
    for source_id in SOURCES:
        adapter = build_adapter(source_id)
        results[source_id] = run_source_pipeline(
            adapter, sink, store, RunContext(mode="sample"))
    return sink, store, results


@pytest.fixture(scope="module")
def observations(pipeline) -> pd.DataFrame:
    sink, _, _ = pipeline
    df = pd.DataFrame([
        {"county_fips": o.county_fips, "period": pd.Timestamp(o.period_start),
         "variable_id": o.variable_id, "value": o.value_numeric}
        for o in sink.observations
    ])
    return df


@pytest.fixture(scope="module")
def feature_matrix(observations) -> pd.DataFrame:
    definitions = load_feature_config().expand()
    return build_feature_matrix(observations, definitions)


def test_all_sources_succeed_end_to_end(pipeline):
    _, _, results = pipeline
    for source_id, r in results.items():
        assert r.status == "succeeded", f"{source_id}: {r.detail}"
        assert r.observations_loaded > 0
        assert r.join_match_rate == 1.0


def test_raw_artifacts_stored_with_hashes(pipeline):
    sink, store, _ = pipeline
    assert len(sink.raw_artifacts) == 3
    for a in sink.raw_artifacts:
        assert len(a["content_hash"]) == 64
        data = store.get(a["file_path"])
        assert len(data) == a["size_bytes"]


def test_lifecycle_promoted_by_evidence_to_production(pipeline):
    sink, _, _ = pipeline
    for source_id in SOURCES:
        assert sink.statuses[source_id] == SourceStatus.PRODUCTION_ALLOWED


def test_rerun_is_idempotent(pipeline, counties, aliases, crosswalks):
    sink, store, _ = pipeline
    before_src = {t: len(rows) for t, rows in sink.src_rows.items()}
    before_obs = len(sink.observations)
    adapter = build_adapter("bls_laus")
    r = run_source_pipeline(adapter, sink, store, RunContext(mode="sample"))
    assert r.status == "succeeded"
    assert {t: len(rows) for t, rows in sink.src_rows.items()} == before_src
    assert len(sink.observations) == before_obs


def test_source_health_updated(pipeline):
    sink, _, _ = pipeline
    for source_id in SOURCES:
        h = sink.health[source_id]
        assert h["status"] == "healthy"
        assert h["county_join_rate"] == 1.0


def test_variable_dictionary_registered(pipeline):
    sink, _, _ = pipeline
    assert "bls_laus_unemployment_rate" in sink.variables
    assert "census_acs_median_household_income" in sink.variables
    assert "fema_nri_risk_score" in sink.variables


def test_feature_matrix_generated(feature_matrix):
    assert not feature_matrix.empty
    produced = set(feature_matrix["feature_id"])
    assert "bls_laus_unemployment_rate__change_12m" in produced
    assert "fema_nri_risk_score__zscore_national" in produced
    assert "census_acs_poverty_population__per_capita" in produced


def test_unemployment_spike_event_reproduced(event_contracts, feature_matrix, observations):
    event = event_contracts["unemployment_spike_2pp_12m"]
    occurrences = detect_occurrences(event, feature_matrix, observations)
    assert occurrences, "planted spikes must be detected"
    spiked = {o.county_fips for o in occurrences}
    # the fixture generator plants spikes in these validation counties
    assert {"22103", "22071", "46102"} <= spiked
    for o in occurrences:
        assert o.trigger_value >= 2.0


def test_experiment_beats_baseline_and_ranks_variables(
    event_contracts, feature_matrix, observations
):
    event = event_contracts["unemployment_spike_2pp_12m"]
    occurrences = detect_occurrences(event, feature_matrix, observations)
    case_control = build_case_control_set(event, occurrences, feature_matrix)
    result = run_experiment(event, case_control, feature_matrix)

    assert result.case_count >= 5
    assert result.control_count > result.case_count
    best = result.best_model
    baseline = next(m for m in result.models if m.model_type == "baseline_national_average")
    assert best.metrics["auc"] > 0.6
    assert best.metrics["auc"] >= baseline.metrics["auc"]
    assert best.rankings, "experiment must produce ranked variables"
    # leakage guards
    assert result.diagnostics["trigger_feature_excluded"]
    assert result.diagnostics["features_precede_label"]
    ranked = {r["feature_id"] for r in best.rankings}
    assert "bls_laus_unemployment_rate__change_12m" not in ranked

    report = validate_experiment(result)
    assert report.passed, [c.check_name for c in report.checks if not c.passed]


def test_scoring_and_scorecard_csv(
    recipe_contracts, event_contracts, feature_matrix, observations, tmp_path
):
    recipe = recipe_contracts["labour_shock_monitor"]
    event = event_contracts[recipe.event_id]
    occurrences = detect_occurrences(event, feature_matrix, observations)
    case_control = build_case_control_set(event, occurrences, feature_matrix)
    result = run_experiment(event, case_control, feature_matrix)

    latest_period = feature_matrix["period"].max()
    latest = matrix_as_of(feature_matrix, latest_period)
    scores = score_counties(recipe, result.best_model, latest,
                            period=str(latest_period.date()), model_version="test-v1")
    assert len(scores) == latest["county_fips"].nunique()
    ranks = sorted(s.rank_national for s in scores)
    assert ranks[0] == 1
    top = min(scores, key=lambda s: s.rank_national)
    assert 0.0 <= top.score <= 1.0
    assert top.evidence["features_used"], "scores must be evidence-backed"

    out = export_scorecard_csv(scores, tmp_path / "scorecard.csv",
                               county_names={"22103": "St. Tammany, LA"})
    with out.open() as fh:
        rows = list(csv.DictReader(fh))
    assert len(rows) == len(scores)
    assert set(rows[0]) == {"county_fips", "county_name", "period", "score",
                            "rank_national", "rank_state", "confidence",
                            "top_positive_factors", "top_negative_factors",
                            "evidence_json"}
    assert rows[0]["rank_national"] == "1"


def test_quarantine_captures_bad_records(counties, aliases, crosswalks, tmp_path):
    """A record with unjoinable geography must land in quarantine, not vanish."""
    from engine.ingestion.sink import MemorySink

    sink = MemorySink(counties=counties, aliases=aliases, crosswalks=crosswalks)
    store = LocalArtifactStore(tmp_path)
    adapter = build_adapter("fema_nri")

    fixture = adapter.sample_fixture(RunContext(mode="sample"))
    lines = fixture.read_text().splitlines()
    lines.append('C99999,99999,Atlantis,Lost,March 2023,50,Relatively High,50,50,50,1000')
    doctored = tmp_path / "fema_nri_sample.csv"
    doctored.write_text("\n".join(lines) + "\n")

    ctx = RunContext(mode="sample", fixtures_dir=tmp_path)
    result = run_source_pipeline(adapter, sink, store, ctx)
    assert result.status == "succeeded"
    assert result.quarantined == 1
    assert sink.quarantined[0]["reason"] == "no_county_match"
    assert result.join_match_rate < 1.0
