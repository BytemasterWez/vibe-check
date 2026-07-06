from datetime import date

from engine.normalisation.normalise import ParsedRecord, normalise_records


def _record(rec_id="22103:2025-1", fips="22103", period=date(2025, 1, 1), rate="4.2"):
    return ParsedRecord(
        source_record_id=rec_id,
        source_row_hash="abc123",
        period_start=period,
        period_end=period,
        values={"unemployment_rate": rate, "labor_force": "100,000"},
        geography={"county_fips": fips},
        raw={"unemployment_rate": rate},
    )


def test_normalise_produces_observations_with_provenance(
    source_contracts, variable_contracts, county_index
):
    contract = source_contracts["bls_laus"]
    variables = {b.variable_id: variable_contracts[b.variable_id] for b in contract.variables}
    result = normalise_records([_record()], contract, variables, county_index,
                               ingestion_run_id=7, raw_artifact_id=3)
    # bindings present in the record: unemployment_rate + labor_force
    assert len(result.observations) == 2
    obs = {o.variable_id: o for o in result.observations}
    rate = obs["bls_laus_unemployment_rate"]
    assert rate.county_fips == "22103"
    assert rate.value_numeric == 4.2
    assert rate.unit == "percent"
    assert rate.confidence == "MATCH_EXACT_FIPS"
    assert rate.time_grain == "month"
    p = rate.provenance_json
    assert p["ingestion_run_id"] == 7
    assert p["raw_artifact_id"] == 3
    assert p["source_record_id"] == "22103:2025-1"
    assert p["source_row_hash"] == "abc123"
    # comma-separated numbers parse
    assert obs["bls_laus_labor_force"].value_numeric == 100000.0


def test_unjoinable_records_are_quarantined_not_dropped(
    source_contracts, variable_contracts, county_index
):
    contract = source_contracts["bls_laus"]
    variables = {b.variable_id: variable_contracts[b.variable_id] for b in contract.variables}
    bad = _record(rec_id="xx", fips="99999")
    result = normalise_records([bad], contract, variables, county_index)
    assert result.observations == []
    assert len(result.quarantined) == 1
    assert result.quarantined[0].reason == "no_county_match"


def test_fuzzy_join_goes_to_quarantine(source_contracts, variable_contracts, county_index):
    contract = source_contracts["bls_laus"]
    variables = {b.variable_id: variable_contracts[b.variable_id] for b in contract.variables}
    rec = _record(rec_id="fz", fips=None)
    rec.geography = {"state": "LA", "county_name": "St Tammany Prish"}
    result = normalise_records([rec], contract, variables, county_index)
    assert result.observations == []
    q = result.quarantined[0]
    assert q.reason == "fuzzy_join_candidate"
    assert q.join_candidate.county_fips == "22103"


def test_unparseable_period_is_quarantined(source_contracts, variable_contracts, county_index):
    contract = source_contracts["bls_laus"]
    variables = {b.variable_id: variable_contracts[b.variable_id] for b in contract.variables}
    rec = _record(period=None)
    result = normalise_records([rec], contract, variables, county_index)
    assert result.observations == []
    assert result.quarantined[0].reason == "unparseable_period"
