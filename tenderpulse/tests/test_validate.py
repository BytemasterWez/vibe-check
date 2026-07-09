from datetime import datetime

from app.normalisation.normalise import normalise_release
from app.validation.validate import validate_notice

NOW = datetime(2026, 7, 9, 12, 0, 0)


def valid_record(**overrides):
    record = normalise_release(
        {
            "ocid": "ocds-b5fd17-test1",
            "id": "r1",
            "tag": ["tender"],
            "tender": {
                "title": "Test tender",
                "datePublished": "2026-07-08T09:00:00Z",
                "tenderPeriod": {"endDate": "2026-08-01T17:00:00Z"},
            },
        },
        "contracts_finder",
        "",
    )
    record.update(overrides)
    return record


def test_valid_record_passes():
    assert validate_notice(valid_record(), now=NOW) == []


def test_missing_required_fields_flagged():
    problems = validate_notice(valid_record(title="", ocid=""), now=NOW)
    assert any("title" in p for p in problems)
    assert any("ocid" in p for p in problems)


def test_bad_ocid_prefix_flagged():
    problems = validate_notice(valid_record(ocid="not-an-ocid"), now=NOW)
    assert any("OCDS identifier" in p for p in problems)


def test_implausible_date_flagged():
    problems = validate_notice(valid_record(deadline_date=datetime(1999, 1, 1)), now=NOW)
    assert any("plausible range" in p for p in problems)


def test_future_published_date_flagged():
    problems = validate_notice(valid_record(published_date=datetime(2026, 9, 1)), now=NOW)
    assert any("future" in p for p in problems)


def test_negative_value_flagged():
    problems = validate_notice(valid_record(value_amount=-5.0), now=NOW)
    assert any("negative" in p for p in problems)


def test_fixture_releases_all_valid(cf_releases, fts_releases):
    for release, source in [(r, "contracts_finder") for r in cf_releases] + [
        (r, "find_a_tender") for r in fts_releases
    ]:
        record = normalise_release(release, source, "")
        assert validate_notice(record, now=NOW) == [], record["ocid"]
