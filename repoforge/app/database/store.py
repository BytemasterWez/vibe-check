"""Database-backed DiscoveryStore + card/edge persistence.

Implements the ``DiscoveryStore`` protocol used by the discovery engine, plus
helpers to persist component cards and compatibility edges. History-preserving:
each observation writes a repository_snapshot rather than discarding the prior
one.
"""

from __future__ import annotations

import json
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database.models import (
    CompatibilityEdgeRow,
    ComponentCardRow,
    DiscoveryQuery,
    Repository,
    RepositorySnapshot,
)
from app.models.schemas import CompatibilityEdge, ComponentCard


def _parse_dt(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


class DbDiscoveryStore:
    def __init__(self, session: Session) -> None:
        self._s = session

    def has_repo(self, github_id: int) -> bool:
        return (
            self._s.scalar(select(Repository.id).where(Repository.github_id == github_id))
            is not None
        )

    def upsert_repo(self, repo: dict, verdict: str, reasons: list[str]) -> bool:
        gid = int(repo["id"])
        owner = repo["owner"]["login"]
        name = repo["name"]
        existing = self._s.scalar(select(Repository).where(Repository.github_id == gid))
        is_new = existing is None
        if existing is None:
            existing = Repository(github_id=gid, owner=owner, name=name,
                                  full_name=f"{owner}/{name}")
            self._s.add(existing)
        existing.html_url = repo.get("html_url", existing.html_url or "")
        existing.description = repo.get("description")
        existing.primary_language = repo.get("language")
        existing.stars = int(repo.get("stargazers_count", 0) or 0)
        existing.forks = int(repo.get("forks_count", 0) or 0)
        existing.open_issues = int(repo.get("open_issues_count", 0) or 0)
        existing.is_fork = bool(repo.get("fork", False))
        existing.archived = bool(repo.get("archived", False))
        existing.pushed_at = _parse_dt(repo.get("pushed_at"))
        existing.status = verdict
        self._s.flush()
        # Preserve history: append a snapshot on every observation.
        self._s.add(
            RepositorySnapshot(
                repository_id=existing.id,
                stars=existing.stars,
                forks=existing.forks,
                open_issues=existing.open_issues,
                archived=existing.archived,
                pushed_at=existing.pushed_at,
                payload={"verdict": verdict, "reasons": reasons},
            )
        )
        self._s.flush()
        return is_new

    def get_checkpoint(self, term: str) -> dict:
        q = self._s.scalar(select(DiscoveryQuery).where(DiscoveryQuery.term == term))
        if q is None:
            return {}
        return dict(q.cursor or {})

    def save_checkpoint(self, term: str, cursor: dict) -> None:
        q = self._s.scalar(select(DiscoveryQuery).where(DiscoveryQuery.term == term))
        if q is None:
            q = DiscoveryQuery(term=term, cursor=cursor)
            self._s.add(q)
        else:
            q.cursor = cursor
        self._s.flush()


def persist_card(session: Session, card: ComponentCard) -> ComponentCardRow:
    repo = session.scalar(
        select(Repository).where(Repository.github_id == card.repository_id)
    )
    row = ComponentCardRow(
        repository_id=repo.id if repo else None,
        commit_sha=card.commit_sha,
        release=card.release,
        capability_summary=card.capability_summary,
        maturity_score=card.maturity_score,
        integration_score=card.integration_score,
        packaging_gap_score=card.packaging_gap_score,
        extraction_confidence=card.extraction_confidence,
        model_version=card.model_version,
        prompt_version=card.prompt_version,
        card=json.loads(card.model_dump_json()),
    )
    session.add(row)
    session.flush()
    return row


def persist_edge(session: Session, edge: CompatibilityEdge) -> None:
    existing = session.scalar(
        select(CompatibilityEdgeRow).where(
            CompatibilityEdgeRow.source_full_name == edge.source,
            CompatibilityEdgeRow.destination_full_name == edge.destination,
            CompatibilityEdgeRow.output == edge.output,
            CompatibilityEdgeRow.input == edge.input,
        )
    )
    if existing is not None:
        existing.confidence = edge.confidence
        existing.evidence = edge.evidence
        session.flush()
        return
    session.add(
        CompatibilityEdgeRow(
            source_full_name=edge.source,
            destination_full_name=edge.destination,
            output=edge.output,
            input=edge.input,
            interface=edge.interface,
            confidence=edge.confidence,
            required_adapter=edge.required_adapter,
            integration_difficulty=edge.integration_difficulty,
            licence_compatible=edge.licence_compatible,
            deployment_compatible=edge.deployment_compatible,
            evidence=edge.evidence,
        )
    )
    session.flush()
