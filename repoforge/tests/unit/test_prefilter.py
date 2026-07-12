from app.discovery.prefilter import Verdict, prefilter


def _repo(**over):
    base = {
        "id": 1,
        "name": "thing",
        "owner": {"login": "acme"},
        "html_url": "https://github.com/acme/thing",
        "description": "a useful library",
        "license": {"spdx_id": "MIT"},
        "stargazers_count": 500,
        "forks_count": 40,
        "open_issues_count": 5,
        "archived": False,
        "fork": False,
        "size": 2000,
        "pushed_at": "2026-06-01T00:00:00Z",
    }
    base.update(over)
    return base


def test_accepts_healthy_repo():
    assert prefilter(_repo()).verdict is Verdict.ACCEPT


def test_rejects_empty_repo():
    r = prefilter(_repo(size=0))
    assert r.verdict is Verdict.REJECT
    assert any("empty" in reason for reason in r.reasons)


def test_rejects_crypto_spam():
    r = prefilter(_repo(description="FREE TOKENS airdrop presale 1000x"))
    assert r.verdict is Verdict.REJECT


def test_rejects_non_commercial_licence():
    r = prefilter(_repo(license={"spdx_id": "CC-BY-NC-4.0"}))
    assert r.verdict is Verdict.REJECT


def test_quarantines_archived():
    r = prefilter(_repo(archived=True))
    assert r.verdict is Verdict.QUARANTINE


def test_quarantines_unknown_licence():
    r = prefilter(_repo(license={"spdx_id": "NOASSERTION"}))
    assert r.verdict is Verdict.QUARANTINE


def test_quarantines_low_adoption():
    r = prefilter(_repo(stargazers_count=1, forks_count=0))
    assert r.verdict is Verdict.QUARANTINE


def test_quarantines_stale_repo():
    r = prefilter(_repo(pushed_at="2020-01-01T00:00:00Z"))
    assert r.verdict is Verdict.QUARANTINE


def test_low_star_fork_is_quarantined():
    r = prefilter(_repo(fork=True, stargazers_count=3))
    assert r.verdict is Verdict.QUARANTINE


def test_reasons_and_signals_never_empty():
    r = prefilter(_repo())
    assert r.reasons
    assert "licence_class" in r.signals
