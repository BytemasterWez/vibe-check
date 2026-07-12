"""Discovery engine: search -> deduplicate -> pre-filter, with checkpointing.

Persistence is injected via a small protocol so the engine can run against the
database in production and an in-memory store in tests (never touching the real
GitHub allowance).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol

from app.discovery.github_client import GitHubClient
from app.discovery.prefilter import FilterResult, Verdict, prefilter
from app.discovery.queries import DateWindow, build_query


class DiscoveryStore(Protocol):
    def has_repo(self, github_id: int) -> bool: ...
    def upsert_repo(self, repo: dict, verdict: str, reasons: list[str]) -> bool: ...
    def get_checkpoint(self, term: str) -> dict: ...
    def save_checkpoint(self, term: str, cursor: dict) -> None: ...


@dataclass
class InMemoryStore:
    """Reference DiscoveryStore for tests and metadata smoke runs."""

    repos: dict[int, dict] = field(default_factory=dict)
    verdicts: dict[int, str] = field(default_factory=dict)
    checkpoints: dict[str, dict] = field(default_factory=dict)

    def has_repo(self, github_id: int) -> bool:
        return github_id in self.repos

    def upsert_repo(self, repo: dict, verdict: str, reasons: list[str]) -> bool:
        gid = int(repo["id"])
        is_new = gid not in self.repos
        self.repos[gid] = repo
        self.verdicts[gid] = verdict
        return is_new

    def get_checkpoint(self, term: str) -> dict:
        return self.checkpoints.get(term, {})

    def save_checkpoint(self, term: str, cursor: dict) -> None:
        self.checkpoints[term] = cursor


@dataclass
class DiscoveryReport:
    term: str
    fetched: int = 0
    new: int = 0
    duplicates: int = 0
    accepted: int = 0
    quarantined: int = 0
    rejected: int = 0
    api_calls_before: int = 0
    api_calls_after: int = 0

    @property
    def api_calls(self) -> int:
        return self.api_calls_after - self.api_calls_before


class DiscoveryEngine:
    def __init__(self, client: GitHubClient, store: DiscoveryStore) -> None:
        self._client = client
        self._store = store

    async def run_term(
        self,
        term: str,
        *,
        window: DateWindow | None = None,
        min_stars: int = 5,
        per_page: int = 50,
        max_pages: int = 1,
    ) -> DiscoveryReport:
        report = DiscoveryReport(term=term)
        report.api_calls_before = self._client.accounting.total_requests

        query = build_query(term, window, min_stars=min_stars)
        items = await self._client.search_repositories(
            query, per_page=per_page, max_pages=max_pages
        )
        report.fetched = len(items)

        for repo in items:
            gid = int(repo["id"])
            if self._store.has_repo(gid):
                report.duplicates += 1
                # Still refresh stored metadata (revisit), but count as dup.
            result: FilterResult = prefilter(repo)
            is_new = self._store.upsert_repo(repo, result.verdict.value, result.reasons)
            if is_new:
                report.new += 1
            if result.verdict is Verdict.ACCEPT:
                report.accepted += 1
            elif result.verdict is Verdict.QUARANTINE:
                report.quarantined += 1
            else:
                report.rejected += 1

        # Checkpoint: advance past this window so a restart resumes correctly.
        cursor = self._store.get_checkpoint(term)
        cursor["last_window_end"] = window.end.isoformat() if window else None
        cursor["last_min_stars"] = min_stars
        self._store.save_checkpoint(term, cursor)

        report.api_calls_after = self._client.accounting.total_requests
        return report
