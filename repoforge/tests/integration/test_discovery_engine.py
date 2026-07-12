from datetime import date

import httpx

from app.discovery.engine import DiscoveryEngine, InMemoryStore
from app.discovery.github_client import GitHubClient
from app.discovery.queries import DateWindow, month_windows


async def _noop_sleep(_):
    return None


def _repo(i, **over):
    r = {
        "id": i,
        "name": f"repo{i}",
        "owner": {"login": "acme"},
        "html_url": f"https://github.com/acme/repo{i}",
        "description": "useful library",
        "license": {"spdx_id": "MIT"},
        "stargazers_count": 300,
        "forks_count": 20,
        "open_issues_count": 3,
        "archived": False,
        "fork": False,
        "size": 1500,
        "pushed_at": "2026-06-01T00:00:00Z",
    }
    r.update(over)
    return r


def _client(items):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={"items": items},
            headers={
                "x-ratelimit-limit": "30",
                "x-ratelimit-remaining": "29",
                "x-ratelimit-reset": "9999999999",
                "x-ratelimit-resource": "search",
            },
        )

    return httpx.MockTransport(handler)


async def test_run_term_stores_and_classifies():
    items = [_repo(1), _repo(2, archived=True), _repo(3, size=0)]
    store = InMemoryStore()
    async with httpx.AsyncClient(transport=_client(items)) as hc:
        gh = GitHubClient("tok", client=hc, sleep=_noop_sleep)
        engine = DiscoveryEngine(gh, store)
        report = await engine.run_term("ocr")
    assert report.fetched == 3
    assert report.new == 3
    assert report.accepted == 1
    assert report.quarantined == 1
    assert report.rejected == 1
    assert report.api_calls == 1


async def test_deduplication_across_runs():
    items = [_repo(1), _repo(2)]
    store = InMemoryStore()
    async with httpx.AsyncClient(transport=_client(items)) as hc:
        gh = GitHubClient("tok", client=hc, sleep=_noop_sleep)
        engine = DiscoveryEngine(gh, store)
        first = await engine.run_term("ocr")
        second = await engine.run_term("ocr")
    assert first.new == 2
    assert second.new == 0
    assert second.duplicates == 2
    assert len(store.repos) == 2  # no duplicate storage


async def test_checkpoint_saved_for_resume():
    window = DateWindow(date(2026, 1, 1), date(2026, 1, 31))
    store = InMemoryStore()
    async with httpx.AsyncClient(transport=_client([_repo(1)])) as hc:
        gh = GitHubClient("tok", client=hc, sleep=_noop_sleep)
        engine = DiscoveryEngine(gh, store)
        await engine.run_term("ocr", window=window)
    cp = store.get_checkpoint("ocr")
    assert cp["last_window_end"] == "2026-01-31"


def test_month_windows_cover_range_without_gaps():
    windows = month_windows(date(2026, 1, 1), date(2026, 6, 1))
    assert windows[0].start == date(2026, 1, 1)
    assert windows[-1].end == date(2026, 6, 1)
    assert len(windows) >= 4
