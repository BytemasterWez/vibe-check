from adapters.base import RunContext
from adapters.registry import ADAPTERS, build_adapter


def test_every_registered_adapter_has_a_contract(source_contracts):
    for source_id in ADAPTERS:
        assert source_id in source_contracts


def test_adapter_contract_mismatch_rejected(source_contracts, variable_contracts):
    import pytest

    from adapters.bls.laus import BlsLausAdapter
    with pytest.raises(ValueError, match="bls_laus"):
        BlsLausAdapter(source_contracts["fema_nri"], {})


def test_bls_laus_parses_fixture():
    adapter = build_adapter("bls_laus")
    artifact = adapter.fetch(RunContext(mode="sample"))
    batch = adapter.parse(artifact)
    assert len(batch.records) > 2000
    rec = batch.records[0]
    assert rec.period_start is not None
    assert rec.period_start.day == 1
    assert rec.period_end.month == rec.period_start.month
    assert "unemployment_rate" in rec.values
    assert rec.geography["state_fips"]
    assert adapter.validate(batch).passed


def test_bls_laus_parses_official_pipe_format():
    adapter = build_adapter("bls_laus")
    text = (
        "LAUCN221030000000000|22|103|St. Tammany Parish, LA|Jun-25|  132,000|126,000|6,000|4.5\n"
    )
    from adapters.base import RawArtifact
    batch = adapter.parse(RawArtifact(filename="laucntycur14.txt", data=text.encode(),
                                      source_url="test://"))
    assert len(batch.records) == 1
    rec = batch.records[0]
    assert rec.period_start.year == 2025 and rec.period_start.month == 6
    assert rec.values["unemployment_rate"] == "4.5"
    assert adapter.src_row(rec)["labor_force"] == 132000.0


def test_census_acs_parses_fixture():
    adapter = build_adapter("census_acs")
    artifact = adapter.fetch(RunContext(mode="sample"))
    batch = adapter.parse(artifact)
    assert len(batch.records) > 50
    rec = batch.records[0]
    assert rec.period_start.month == 1 and rec.period_end.month == 12
    assert rec.geography["geoid"]
    rows = adapter.src_rows(rec)
    assert len(rows) == 4                     # one src row per ACS variable
    assert len({r["source_record_id"] for r in rows}) == 4


def test_census_suppression_sentinel_becomes_null():
    from adapters.census.acs import _num
    assert _num("-666666666") is None
    assert _num("52000") == 52000.0


def test_fema_nri_parses_fixture_with_vintage_date():
    adapter = build_adapter("fema_nri")
    artifact = adapter.fetch(RunContext(mode="sample"))
    batch = adapter.parse(artifact)
    assert len(batch.records) > 50
    rec = batch.records[0]
    assert str(rec.period_start) == "2023-03-01"   # from NRI_VER, not retrieval date
    assert rec.geography["county_fips"].isdigit()
    assert adapter.validate(batch).passed
