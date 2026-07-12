"""Scheduled task bodies. Each is idempotent and safe to run repeatedly.

Tasks receive a live Session and Settings. They never assume external services
are up: missing GitHub token or unreachable Ollama degrade gracefully instead of
crashing the scheduler.
"""

from __future__ import annotations

import logging

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import Mode, Settings
from app.database.models import DiscoveryQuery
from app.database.store import DbDiscoveryStore
from app.discovery.engine import DiscoveryEngine
from app.discovery.github_client import BudgetExceeded, GitHubClient, RateLimitError
from app.discovery.queries import SEED_CAPABILITY_FAMILIES

logger = logging.getLogger("repoforge.tasks")


def ensure_seed_queries(session: Session) -> int:
    """Insert any missing seed capability families as active discovery queries."""
    existing = set(session.scalars(select(DiscoveryQuery.term)).all())
    added = 0
    for term in SEED_CAPABILITY_FAMILIES:
        if term not in existing:
            session.add(DiscoveryQuery(term=term, family=term, status="active"))
            added += 1
    session.flush()
    return added


def _next_term(session: Session) -> DiscoveryQuery | None:
    """Least-recently-updated active query (round-robin rotation)."""
    return session.scalar(
        select(DiscoveryQuery)
        .where(DiscoveryQuery.status == "active")
        .order_by(DiscoveryQuery.updated_at.asc())
        .limit(1)
    )


async def discovery_tick(session: Session, settings: Settings) -> dict:
    """Run one rotating discovery query against GitHub and store results."""
    if settings.repoforge_mode is Mode.paused:
        return {"skipped": "paused"}
    if not settings.github_configured:
        logger.info("discovery_tick: no GITHUB_TOKEN; skipping")
        return {"skipped": "no_token"}

    ensure_seed_queries(session)
    query = _next_term(session)
    if query is None:
        return {"skipped": "no_terms"}

    store = DbDiscoveryStore(session)
    async with GitHubClient(
        settings.github_token,
        budget_per_hour=settings.github_api_budget_per_hour,
        max_concurrency=settings.github_max_concurrency,
        base_url=settings.github_api_base,
    ) as gh:
        engine = DiscoveryEngine(gh, store)
        try:
            report = await engine.run_term(query.term, per_page=25, max_pages=1)
        except (RateLimitError, BudgetExceeded) as exc:
            logger.warning("discovery_tick: rate/budget limit on '%s': %s", query.term, exc)
            return {"term": query.term, "deferred": str(exc)}

    # Update term productivity so unproductive terms can be de-prioritised later.
    query.total_hits += report.fetched
    query.relevant_hits += report.accepted
    session.flush()
    return {
        "term": query.term,
        "fetched": report.fetched,
        "new": report.new,
        "accepted": report.accepted,
        "quarantined": report.quarantined,
        "rejected": report.rejected,
        "api_calls": report.api_calls,
    }
