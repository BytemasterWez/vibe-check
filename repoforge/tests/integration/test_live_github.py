"""Live GitHub smoke test. Deselected by default (marker: live).

Run explicitly with:  pytest -m live
Requires GITHUB_TOKEN in the environment. Consumes a tiny amount of the real
API allowance (a single search page).
"""

import os

import pytest

from app.discovery.engine import DiscoveryEngine, InMemoryStore
from app.discovery.github_client import GitHubClient

pytestmark = pytest.mark.live


async def test_live_discovery_returns_real_repositories():
    token = os.environ.get("GITHUB_TOKEN")
    if not token:
        pytest.skip("GITHUB_TOKEN not set")
    store = InMemoryStore()
    async with GitHubClient(token, budget_per_hour=50, max_concurrency=1) as gh:
        engine = DiscoveryEngine(gh, store)
        report = await engine.run_term("document parsing", min_stars=100, per_page=10)
    assert report.fetched > 0
    assert report.new > 0
    assert gh.core.remaining >= 0 or gh.search.remaining >= 0
    # Stored repos are genuine GitHub payloads with real ids and URLs.
    sample = next(iter(store.repos.values()))
    assert sample["id"] > 0
    assert "github.com" in sample["html_url"]
