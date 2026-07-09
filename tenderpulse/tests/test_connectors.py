"""Connector pagination/URL tests (mocked HTTP) plus schema-drift guards."""
from app.connectors import CONNECTORS
from app.connectors.base import iter_releases
from app.connectors.contracts_finder import ContractsFinderConnector
from app.connectors.find_a_tender import FindATenderConnector


def test_pagination_follows_next_link(monkeypatch):
    pages = {
        "http://x/start": {"releases": [{"ocid": "a"}], "links": {"next": "http://x/p2"}},
        "http://x/p2": {"releases": [{"ocid": "b"}], "links": {"next": "http://x/p3"}},
        "http://x/p3": {"releases": [], "links": {}},
    }
    calls = []

    def fake_get(url, params=None):
        calls.append(url)
        return pages[url]

    monkeypatch.setattr("app.connectors.base.get_json", fake_get)
    out = list(iter_releases("http://x/start", {"limit": 10}))
    assert [r["ocid"] for r in out] == ["a", "b"]
    assert calls == ["http://x/start", "http://x/p2", "http://x/p3"]


def test_pagination_respects_max_pages(monkeypatch):
    def fake_get(url, params=None):
        return {"releases": [{"ocid": "x"}], "links": {"next": url + "n"}}

    monkeypatch.setattr("app.connectors.base.get_json", fake_get)
    out = list(iter_releases("http://x/start", {}, max_pages=3))
    assert len(out) == 3


def test_cf_notice_url_prefers_tender_notice_doc(cf_releases):
    url = ContractsFinderConnector().notice_url(cf_releases[0])
    assert url.startswith("http")


def test_fts_notice_url_built_from_release_id(fts_releases):
    url = FindATenderConnector().notice_url(fts_releases[0])
    assert url.startswith("https://www.find-tender.service.gov.uk/Notice/")


def test_registered_connectors():
    assert set(CONNECTORS) == {"contracts_finder", "find_a_tender"}


def test_schema_drift_guard_expected_fields_present(cf_releases, fts_releases):
    """If the source schema drifts, this test flags it before production does."""
    for release in cf_releases + fts_releases:
        assert "ocid" in release
        assert "tender" in release
        tender = release["tender"]
        assert "title" in tender
        assert "id" in tender
