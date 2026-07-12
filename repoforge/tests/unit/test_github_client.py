import httpx
import pytest

from app.discovery.github_client import (
    BudgetExceeded,
    GitHubClient,
    RateLimitError,
    _next_link,
)


async def _noop_sleep(_seconds):
    return None


def _rate_headers(remaining="4999", resource="core"):
    return {
        "x-ratelimit-limit": "5000",
        "x-ratelimit-remaining": remaining,
        "x-ratelimit-reset": "9999999999",
        "x-ratelimit-resource": resource,
    }


def test_next_link_parsing():
    header = (
        '<https://api.github.com/x?page=2>; rel="next", '
        '<https://api.github.com/x?page=5>; rel="last"'
    )
    assert _next_link(header) == "https://api.github.com/x?page=2"
    assert _next_link(None) is None
    assert _next_link('<https://x>; rel="last"') is None


async def test_pagination_follows_next_link():
    pages = {1: ["a", "b"], 2: ["c"]}

    def handler(request: httpx.Request) -> httpx.Response:
        page = int(request.url.params.get("page", "1"))
        items = [{"id": i, "name": n} for i, n in enumerate(pages[page])]
        headers = _rate_headers(resource="search")
        if page == 1:
            headers["link"] = (
                f'<{request.url.copy_with(params={"page": 2})}>; rel="next"'
            )
        return httpx.Response(200, json={"items": items}, headers=headers)

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as hc:
        gh = GitHubClient("tok", client=hc, sleep=_noop_sleep)
        results = await gh.search_repositories("q", max_pages=5)
    assert len(results) == 3


async def test_conditional_request_304_is_free_and_counted():
    def handler(request: httpx.Request) -> httpx.Response:
        if request.headers.get("If-None-Match") == 'W/"abc"':
            return httpx.Response(304, headers=_rate_headers())
        return httpx.Response(200, json={"id": 1}, headers=_rate_headers())

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as hc:
        gh = GitHubClient("tok", client=hc, sleep=_noop_sleep)
        resp = await gh.request("GET", "/repos/a/b", etag='W/"abc"')
    assert resp.status_code == 304
    assert gh.accounting.conditional_hits == 1


async def test_rate_limit_retry_after_then_success():
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        if calls["n"] == 1:
            return httpx.Response(
                429, headers={**_rate_headers(remaining="0"), "retry-after": "1"}
            )
        return httpx.Response(200, json={"ok": True}, headers=_rate_headers())

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as hc:
        gh = GitHubClient("tok", client=hc, sleep=_noop_sleep)
        resp = await gh.request("GET", "/x")
    assert resp.status_code == 200
    assert calls["n"] == 2


async def test_rate_limit_gives_up_after_retries():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(403, headers={**_rate_headers(remaining="0"), "retry-after": "1"})

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as hc:
        gh = GitHubClient("tok", client=hc, sleep=_noop_sleep, max_retries=2)
        with pytest.raises(RateLimitError):
            await gh.request("GET", "/x")


async def test_budget_exhaustion_raises():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={}, headers=_rate_headers())

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as hc:
        gh = GitHubClient("tok", client=hc, sleep=_noop_sleep, budget_per_hour=2)
        await gh.request("GET", "/1")
        await gh.request("GET", "/2")
        with pytest.raises(BudgetExceeded):
            await gh.request("GET", "/3")


async def test_rate_limit_state_tracked_per_resource():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"items": []},
                              headers=_rate_headers(remaining="12", resource="search"))

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as hc:
        gh = GitHubClient("tok", client=hc, sleep=_noop_sleep)
        await gh.search_repositories("q")
    assert gh.search.remaining == 12
    assert gh.search.resource == "search"


async def test_token_never_appears_in_headers_log():
    # The Authorization header carries the token but the client must not expose it.
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["Authorization"] == "Bearer secret-token"
        return httpx.Response(200, json={}, headers=_rate_headers())

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as hc:
        gh = GitHubClient("secret-token", client=hc, sleep=_noop_sleep)
        await gh.request("GET", "/x")
    # repr/str of the client must not leak the token
    assert "secret-token" not in repr(gh)
