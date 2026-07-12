"""Component-card construction.

In ``metadata`` mode the card is built purely from deterministic GitHub metadata
(no Ollama). In ``local_ai`` mode a classifier can enrich capability/role/IO
fields, but any field the model cannot support with evidence stays ``None`` —
the model never invents licences, hardware, interfaces or users.
"""

from __future__ import annotations

import re
from datetime import UTC, datetime

from app.licensing.policy import classify
from app.models.schemas import (
    ComponentCard,
    DeploymentProfile,
    Role,
)

# Cheap keyword → role heuristics for metadata mode. These are explicitly
# marked low-confidence; local_ai mode replaces them with evidenced roles.
_ROLE_KEYWORDS: dict[Role, tuple[str, ...]] = {
    Role.parser: ("parse", "parser", "extract text", "ocr", "pdf", "document"),
    Role.classifier: ("classify", "classifier", "categor", "detection", "recogni"),
    Role.transformer: ("transform", "convert", "pipeline", "etl"),
    Role.vector_store: ("vector", "embedding", "faiss", "pgvector", "ann index"),
    Role.knowledge_store: ("knowledge graph", "database", "datastore", "store"),
    Role.reasoner: ("reason", "llm", "agent", "inference"),
    Role.interface: ("api", "rest", "graphql", "sdk", "cli"),
    Role.reporter: ("report", "dashboard", "visuali", "export"),
    Role.automation: ("automation", "workflow", "rpa", "scheduler", "orchestrat"),
    Role.validator: ("validate", "validation", "schema", "verify"),
    Role.collector: ("scrape", "collect", "crawler", "ingest", "connector"),
}

_INTERFACE_KEYWORDS: dict[str, tuple[str, ...]] = {
    "rest": ("rest api", "http api", "openapi", "swagger", "fastapi", "flask"),
    "cli": ("command line", "cli", "command-line"),
    "python": ("pip install", "import ", "python package", "pypi"),
    "grpc": ("grpc",),
    "graphql": ("graphql",),
    "docker": ("docker", "dockerfile", "docker-compose", "container image"),
}


def _detect(text: str, table: dict) -> list:
    text_l = text.lower()
    found = []
    for key, markers in table.items():
        if any(m in text_l for m in markers):
            found.append(key)
    return found


def build_card_from_metadata(
    repo: dict,
    *,
    readme: str | None = None,
    commit_sha: str | None = None,
    release: str | None = None,
) -> ComponentCard:
    """Deterministic card. Provenance is implicitly github_api / readme."""
    owner = repo["owner"]["login"]
    name = repo["name"]
    lic = repo.get("license") or {}
    spdx = lic.get("spdx_id") if isinstance(lic, dict) else None
    licence = classify(spdx, licence_file_url=repo.get("html_url"))

    text = " ".join(
        filter(
            None,
            [repo.get("description") or "", " ".join(repo.get("topics", []) or []), readme or ""],
        )
    )

    roles = _detect(text, _ROLE_KEYWORDS)
    interfaces = _detect(text, _INTERFACE_KEYWORDS)

    docker_available = "docker" in interfaces or bool(
        re.search(r"\bdockerfile\b", text, re.IGNORECASE)
    )
    has_tests = bool(re.search(r"\b(pytest|unittest|jest|go test|tests?/)\b", text, re.IGNORECASE))

    pushed = repo.get("pushed_at")
    pushed_dt = None
    if pushed:
        try:
            pushed_dt = datetime.fromisoformat(pushed.replace("Z", "+00:00"))
        except ValueError:
            pushed_dt = None

    stars = int(repo.get("stargazers_count", 0) or 0)
    forks = int(repo.get("forks_count", 0) or 0)

    card = ComponentCard(
        owner=owner,
        repo=name,
        canonical_url=repo.get("html_url", f"https://github.com/{owner}/{name}"),
        repository_id=int(repo["id"]),
        commit_sha=commit_sha,
        release=release,
        description=repo.get("description"),
        capability_summary=repo.get("description"),
        roles=roles,
        interfaces=interfaces,
        languages=[repo["language"]] if repo.get("language") else [],
        deployment=DeploymentProfile(
            docker_available=docker_available,
            cpu_only_capable=None,  # unknown without deeper analysis
            gpu_required=None,
            offline_capable=None,
            supported_os=[],
        ),
        licence=licence,
        stars=stars,
        forks=forks,
        open_issues=int(repo.get("open_issues_count", 0) or 0),
        archived=bool(repo.get("archived", False)),
        pushed_at=pushed_dt,
        has_tests=has_tests or None,
        has_ci=None,
        maturity_score=_maturity_score(stars, forks, pushed_dt, repo.get("archived", False)),
        integration_score=_integration_score(interfaces, docker_available),
        packaging_gap_score=0.0,
        evidence_urls=[repo.get("html_url", "")],
        extraction_confidence=0.5,  # metadata-only baseline
        model_version="metadata-only",
        prompt_version="n/a",
    )
    return card


def _maturity_score(stars: int, forks: int, pushed: datetime | None, archived: bool) -> float:
    if archived:
        return 0.1
    import math

    star_component = min(1.0, math.log10(stars + 1) / 4.0)  # ~10k stars -> 1.0
    fork_component = min(1.0, math.log10(forks + 1) / 3.0)
    recency = 0.5
    if pushed is not None:

        days = (datetime.now(UTC) - pushed).days
        recency = max(0.0, 1.0 - days / 730.0)  # decays over 2 years
    return round(0.5 * star_component + 0.2 * fork_component + 0.3 * recency, 3)


def _integration_score(interfaces: list, docker: bool) -> float:
    score = 0.0
    if interfaces:
        score += min(0.6, 0.2 * len(interfaces))
    if docker:
        score += 0.4
    return round(min(1.0, score), 3)
