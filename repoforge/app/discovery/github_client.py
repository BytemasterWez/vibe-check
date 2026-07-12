"""GitHub REST client with the reliability behaviours the spec requires.

Features: authenticated read-only access, rate-limit + search-rate-limit
awareness, ETag / If-Modified-Since conditional requests, pagination via Link
headers, exponential backoff, Retry-After and 403/429 handling, an hourly API
budget, and request accounting. The token is never logged.

The client is constructed around an injectable ``httpx.AsyncClient`` so tests
can drive it with a mock transport and never touch the real allowance.
"""

from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from email.utils import parsedate_to_datetime
from typing import Any

import httpx

logger = logging.getLogger("repoforge.github")

_USER_AGENT = "RepoForge/0.1 (+https://github.com/repoforge)"


class RateLimitError(RuntimeError):
    """Raised when the client cannot proceed without exceeding limits."""


class BudgetExceeded(RuntimeError):
    """Raised when the configured hourly API budget is exhausted."""


@dataclass
class ApiAccounting:
    """Tracks requests and the rolling hourly budget."""

    budget_per_hour: int
    _window_start: float = field(default_factory=time.monotonic)
    _count: int = 0
    total_requests: int = 0
    conditional_hits: int = 0  # 304 responses (free)

    def _roll(self) -> None:
        now = time.monotonic()
        if now - self._window_start >= 3600:
            self._window_start = now
            self._count = 0

    def check(self) -> None:
        self._roll()
        if self._count >= self.budget_per_hour:
            raise BudgetExceeded(
                f"Hourly API budget of {self.budget_per_hour} exhausted"
            )

    def record(self, *, conditional: bool = False) -> None:
        self._count += 1
        self.total_requests += 1
        if conditional:
            self.conditional_hits += 1

    @property
    def remaining_budget(self) -> int:
        self._roll()
        return max(0, self.budget_per_hour - self._count)


@dataclass
class RateLimitState:
    limit: int = 0
    remaining: int = -1
    reset_epoch: int = 0
    resource: str = "core"


class GitHubClient:
    def __init__(
        self,
        token: str,
        *,
        client: httpx.AsyncClient | None = None,
        budget_per_hour: int = 1000,
        max_concurrency: int = 3,
        base_url: str = "https://api.github.com",
        max_retries: int = 4,
        sleep: Callable[[float], Awaitable[Any]] | None = None,
    ) -> None:
        self._token = token
        self._base = base_url.rstrip("/")
        self._max_retries = max_retries
        self._sem = asyncio.Semaphore(max_concurrency)
        self.accounting = ApiAccounting(budget_per_hour=budget_per_hour)
        self.core = RateLimitState(resource="core")
        self.search = RateLimitState(resource="search")
        # Injected sleep so tests run instantly without real waits.
        self._sleep = sleep or asyncio.sleep
        self._default_headers = {
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": _USER_AGENT,
        }
        if token:
            self._default_headers["Authorization"] = f"Bearer {token}"
        self._owns_client = client is None
        self._client = client or httpx.AsyncClient(timeout=30.0)

    async def aclose(self) -> None:
        if self._owns_client:
            await self._client.aclose()

    async def __aenter__(self) -> GitHubClient:
        return self

    async def __aexit__(self, *exc: object) -> None:
        await self.aclose()

    # ---------------------------------------------------------------- #
    def _update_rate_limit(self, resp: httpx.Response) -> None:
        resource = resp.headers.get("x-ratelimit-resource", "core")
        state = self.search if resource == "search" else self.core
        try:
            state.limit = int(resp.headers.get("x-ratelimit-limit", state.limit))
            state.remaining = int(resp.headers.get("x-ratelimit-remaining", state.remaining))
            state.reset_epoch = int(resp.headers.get("x-ratelimit-reset", state.reset_epoch))
            state.resource = resource
        except ValueError:
            pass

    def _retry_after_seconds(self, resp: httpx.Response) -> float | None:
        ra = resp.headers.get("retry-after")
        if ra:
            try:
                return float(ra)
            except ValueError:
                try:
                    dt = parsedate_to_datetime(ra)
                    return max(0.0, dt.timestamp() - time.time())
                except (TypeError, ValueError):
                    return None
        # Secondary/primary rate limit: honour x-ratelimit-reset when remaining==0
        if resp.headers.get("x-ratelimit-remaining") == "0":
            reset = resp.headers.get("x-ratelimit-reset")
            if reset:
                try:
                    return max(0.0, int(reset) - time.time())
                except ValueError:
                    return None
        return None

    async def request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        etag: str | None = None,
        modified_since: str | None = None,
    ) -> httpx.Response:
        """Perform one request with budget, conditional headers, backoff and
        rate-limit handling. Returns the final ``httpx.Response`` (which may be a
        304 Not Modified — callers should check ``resp.status_code``)."""
        url = path if path.startswith("http") else f"{self._base}{path}"
        headers: dict[str, str] = dict(self._default_headers)
        if etag:
            headers["If-None-Match"] = etag
        if modified_since:
            headers["If-Modified-Since"] = modified_since

        attempt = 0
        async with self._sem:
            while True:
                self.accounting.check()
                resp = await self._client.request(method, url, params=params, headers=headers)
                self._update_rate_limit(resp)
                conditional = resp.status_code == 304
                self.accounting.record(conditional=conditional)

                if resp.status_code < 400 or resp.status_code == 304:
                    return resp

                if resp.status_code in (403, 429):
                    wait = self._retry_after_seconds(resp)
                    if wait is not None and attempt < self._max_retries:
                        logger.warning(
                            "rate-limited (%s) on %s; waiting %.1fs",
                            resp.status_code, path, wait,
                        )
                        await self._sleep(min(wait, 3600))
                        attempt += 1
                        continue
                    raise RateLimitError(
                        f"{resp.status_code} on {path}; giving up after {attempt} retries"
                    )

                if resp.status_code >= 500 and attempt < self._max_retries:
                    backoff = 2 ** attempt
                    logger.warning("server error %s on %s; backoff %ss",
                                   resp.status_code, path, backoff)
                    await self._sleep(backoff)
                    attempt += 1
                    continue

                resp.raise_for_status()
                return resp  # pragma: no cover

    # ---------------------------------------------------------------- #
    async def search_repositories(
        self,
        query: str,
        *,
        sort: str = "updated",
        order: str = "desc",
        per_page: int = 50,
        max_pages: int = 1,
    ) -> list[dict]:
        """Paginated repository search. Follows Link rel="next" up to ``max_pages``."""
        results: list[dict] = []
        params: dict[str, Any] = {
            "q": query,
            "sort": sort,
            "order": order,
            "per_page": per_page,
            "page": 1,
        }
        pages = 0
        next_path: str | None = "/search/repositories"
        while next_path and pages < max_pages:
            resp = await self.request("GET", next_path, params=params if pages == 0 else None)
            data = resp.json()
            results.extend(data.get("items", []))
            pages += 1
            next_path = _next_link(resp.headers.get("link"))
        return results

    async def get_repo(self, owner: str, repo: str, *, etag: str | None = None) -> httpx.Response:
        return await self.request("GET", f"/repos/{owner}/{repo}", etag=etag)

    async def get_readme(self, owner: str, repo: str) -> str | None:
        resp = await self.request(
            "GET",
            f"/repos/{owner}/{repo}/readme",
            params={},
        )
        if resp.status_code == 304:
            return None
        data = resp.json()
        import base64

        content = data.get("content")
        if not content:
            return None
        try:
            return base64.b64decode(content).decode("utf-8", "replace")
        except (ValueError, TypeError):
            return None


def _next_link(link_header: str | None) -> str | None:
    """Parse a GitHub Link header and return the rel="next" URL, if any."""
    if not link_header:
        return None
    for part in link_header.split(","):
        segments = part.split(";")
        if len(segments) < 2:
            continue
        url = segments[0].strip().strip("<>")
        rel = segments[1].strip()
        if rel == 'rel="next"':
            return url
    return None
