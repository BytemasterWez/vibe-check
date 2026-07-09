from datetime import datetime

from app.normalisation.normalise import (
    clean_text,
    normalise_release,
    parse_amount,
    parse_date,
    payload_hash,
)


def test_parse_date_variants():
    assert parse_date("2026-07-07T17:45:09+01:00") == datetime(2026, 7, 7, 16, 45, 9)
    assert parse_date("2027-02-28T23:59:59Z") == datetime(2027, 2, 28, 23, 59, 59)
    assert parse_date("2026-08-04") == datetime(2026, 8, 4)
    assert parse_date(None) is None
    assert parse_date("not a date") is None
    assert parse_date("") is None


def test_parse_amount_variants():
    assert parse_amount(5000000) == 5000000.0
    assert parse_amount("1,250,000") == 1250000.0
    assert parse_amount("£30000") == 30000.0
    assert parse_amount(None) is None
    assert parse_amount("n/a") is None


def test_clean_text_collapses_whitespace():
    assert clean_text("a\r\n b\t c") == "a b c"
    assert clean_text(None) == ""


def test_normalise_contracts_finder_release(cf_releases):
    record = normalise_release(cf_releases[0], "contracts_finder", "http://example/notice")
    assert record["ocid"].startswith("ocds-")
    assert record["title"]
    assert record["source_name"] == "contracts_finder"
    assert isinstance(record["cpv_codes"], list) and record["cpv_codes"]
    assert all(isinstance(c, str) for c in record["cpv_codes"])
    assert record["deadline_date"] is None or isinstance(record["deadline_date"], datetime)
    assert record["raw_payload_hash"] == payload_hash(cf_releases[0])


def test_normalise_find_a_tender_release(fts_releases):
    record = normalise_release(fts_releases[0], "find_a_tender", "")
    assert record["ocid"].startswith("ocds-")
    assert record["buyer_name"]
    assert record["source_name"] == "find_a_tender"


def test_normalise_minimal_release_does_not_crash():
    record = normalise_release({"ocid": "ocds-x-1", "id": "1"}, "contracts_finder", "")
    assert record["ocid"] == "ocds-x-1"
    assert record["title"] == ""
    assert record["value_amount"] is None
    assert record["regions"] == []


def test_value_midpoint_from_min_max():
    release = {
        "ocid": "ocds-x-2", "id": "2",
        "tender": {
            "title": "t",
            "minValue": {"amount": 100, "currency": "GBP"},
            "maxValue": {"amount": 300, "currency": "GBP"},
        },
    }
    record = normalise_release(release, "contracts_finder", "")
    assert record["value_amount"] == 200.0
    assert record["value_min"] == 100.0
    assert record["value_max"] == 300.0
    assert record["value_currency"] == "GBP"
