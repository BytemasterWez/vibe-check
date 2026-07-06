import pytest
from pydantic import ValidationError

from engine.contracts import (
    FeatureConfig,
    SourceContract,
    SourceStatus,
    can_affect_scores,
    can_write_norm,
    load_feature_config,
)


def test_all_source_contracts_load(source_contracts):
    assert {"bls_laus", "census_acs", "fema_nri"} <= set(source_contracts)
    for c in source_contracts.values():
        assert c.provenance_required, f"{c.source_id}: provenance is non-negotiable"
        assert not c.scraping_allowed
        assert c.canonical_join_key == "county_fips"
        assert c.contract_hash and c.source_version


def test_contract_variables_are_registered(source_contracts, variable_contracts):
    """Design rule 11: no score without supporting variables in the store."""
    for c in source_contracts.values():
        for binding in c.variables:
            assert binding.variable_id in variable_contracts, (
                f"{c.source_id} binds {binding.variable_id} which is not in the "
                "variable dictionary contracts")


def test_event_contracts_reference_known_variables(event_contracts, variable_contracts):
    spike = event_contracts["unemployment_spike_2pp_12m"]
    assert spike.base_variable in variable_contracts
    assert spike.condition.operator == ">="
    assert spike.condition.threshold == 2.0
    assert spike.minimum_history_months == 12


def test_recipe_contracts_reference_known_events(recipe_contracts, event_contracts):
    recipe = recipe_contracts["labour_shock_monitor"]
    assert recipe.event_id in event_contracts
    assert recipe.api_exposed


def test_lifecycle_gates():
    assert not can_write_norm(SourceStatus.SCHEMA_MAPPED)
    assert can_write_norm(SourceStatus.VALIDATION_PASSING)
    assert not can_affect_scores(SourceStatus.VALIDATION_PASSING)
    assert can_affect_scores(SourceStatus.COUNTY_JOIN_PASSING)
    assert can_affect_scores(SourceStatus.PRODUCTION_ALLOWED)
    assert not can_write_norm(SourceStatus.DISABLED)
    assert not can_affect_scores(SourceStatus.DISABLED)


def test_scraping_access_method_rejected_without_permission():
    base = dict(
        source_id="bad", name="Bad", owner="X", category="labour",
        access_method="scrape", licence_status="unknown",
        geography_level="county", time_grain="month",
    )
    with pytest.raises(ValidationError):
        SourceContract(**base)
    ok = SourceContract(**{**base, "scraping_allowed": True})
    assert ok.access_method == "scrape"


def test_feature_config_expansion():
    config = load_feature_config()
    defs = config.expand()
    ids = {d["feature_id"] for d in defs}
    assert "bls_laus_unemployment_rate__change_12m" in ids
    assert "census_acs_poverty_population__per_capita" in ids
    assert len(ids) == len(defs), "duplicate feature ids in config"
    for d in defs:
        assert d["feature_id"] == f"{d['variable_id']}__{d['transform']}"


def test_feature_config_expand_is_pure():
    cfg = FeatureConfig(feature_sets=[{"variables": ["v"], "transforms": ["latest_value"]}])
    assert cfg.expand() == [{"feature_id": "v__latest_value", "variable_id": "v",
                             "transform": "latest_value", "params": {}}]
