"""SQLAlchemy ORM models for RepoForge's normalized schema.

These define the storage shape. History-preserving tables (``*_snapshots``)
never overwrite earlier evidence. The Alembic migration in
``migrations/versions`` is the source of truth for production DDL; this module
must stay in sync with it.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.base import Base, created_at_column, updated_at_column


class Repository(Base):
    __tablename__ = "repositories"

    id: Mapped[int] = mapped_column(primary_key=True)
    github_id: Mapped[int] = mapped_column(BigInteger, unique=True, index=True)
    owner: Mapped[str] = mapped_column(String(255), index=True)
    name: Mapped[str] = mapped_column(String(255), index=True)
    full_name: Mapped[str] = mapped_column(String(512), unique=True, index=True)
    html_url: Mapped[str] = mapped_column(String(1024))
    description: Mapped[str | None] = mapped_column(Text)
    primary_language: Mapped[str | None] = mapped_column(String(128))
    stars: Mapped[int] = mapped_column(Integer, default=0)
    forks: Mapped[int] = mapped_column(Integer, default=0)
    open_issues: Mapped[int] = mapped_column(Integer, default=0)
    is_fork: Mapped[bool] = mapped_column(Boolean, default=False)
    archived: Mapped[bool] = mapped_column(Boolean, default=False)
    pushed_at: Mapped[datetime | None] = mapped_column()
    etag: Mapped[str | None] = mapped_column(String(255))
    last_modified: Mapped[str | None] = mapped_column(String(255))
    status: Mapped[str] = mapped_column(String(32), default="discovered", index=True)
    created_at = created_at_column()
    updated_at = updated_at_column()

    snapshots: Mapped[list[RepositorySnapshot]] = relationship(back_populates="repository")


class RepositorySnapshot(Base):
    __tablename__ = "repository_snapshots"

    id: Mapped[int] = mapped_column(primary_key=True)
    repository_id: Mapped[int] = mapped_column(ForeignKey("repositories.id"), index=True)
    stars: Mapped[int] = mapped_column(Integer, default=0)
    forks: Mapped[int] = mapped_column(Integer, default=0)
    open_issues: Mapped[int] = mapped_column(Integer, default=0)
    archived: Mapped[bool] = mapped_column(Boolean, default=False)
    pushed_at: Mapped[datetime | None] = mapped_column()
    payload: Mapped[dict] = mapped_column(JSONB, default=dict)
    created_at = created_at_column()

    repository: Mapped[Repository] = relationship(back_populates="snapshots")


class Release(Base):
    __tablename__ = "releases"

    id: Mapped[int] = mapped_column(primary_key=True)
    repository_id: Mapped[int] = mapped_column(ForeignKey("repositories.id"), index=True)
    tag: Mapped[str] = mapped_column(String(255))
    name: Mapped[str | None] = mapped_column(String(512))
    published_at: Mapped[datetime | None] = mapped_column()
    created_at = created_at_column()
    __table_args__ = (UniqueConstraint("repository_id", "tag", name="uq_release_repo_tag"),)


class Licence(Base):
    __tablename__ = "licences"

    id: Mapped[int] = mapped_column(primary_key=True)
    repository_id: Mapped[int] = mapped_column(ForeignKey("repositories.id"), index=True)
    spdx_id: Mapped[str | None] = mapped_column(String(128))
    licence_class: Mapped[str] = mapped_column(String(64), default="unknown")
    commercial_use: Mapped[bool | None] = mapped_column(Boolean)
    licence_file_url: Mapped[str | None] = mapped_column(String(1024))
    text_sha256: Mapped[str | None] = mapped_column(String(64))
    detection_method: Mapped[str] = mapped_column(String(64), default="unknown")
    confidence: Mapped[float] = mapped_column(Float, default=0.0)
    network_copyleft: Mapped[bool | None] = mapped_column(Boolean)
    created_at = created_at_column()


class LicenceSnapshot(Base):
    __tablename__ = "licence_snapshots"

    id: Mapped[int] = mapped_column(primary_key=True)
    repository_id: Mapped[int] = mapped_column(ForeignKey("repositories.id"), index=True)
    spdx_id: Mapped[str | None] = mapped_column(String(128))
    licence_class: Mapped[str] = mapped_column(String(64))
    payload: Mapped[dict] = mapped_column(JSONB, default=dict)
    created_at = created_at_column()


class ComponentCardRow(Base):
    __tablename__ = "component_cards"

    id: Mapped[int] = mapped_column(primary_key=True)
    repository_id: Mapped[int] = mapped_column(ForeignKey("repositories.id"), index=True)
    commit_sha: Mapped[str | None] = mapped_column(String(64))
    release: Mapped[str | None] = mapped_column(String(255))
    capability_summary: Mapped[str | None] = mapped_column(Text)
    maturity_score: Mapped[float] = mapped_column(Float, default=0.0)
    integration_score: Mapped[float] = mapped_column(Float, default=0.0)
    packaging_gap_score: Mapped[float] = mapped_column(Float, default=0.0)
    extraction_confidence: Mapped[float] = mapped_column(Float, default=0.0)
    model_version: Mapped[str | None] = mapped_column(String(128))
    prompt_version: Mapped[str | None] = mapped_column(String(64))
    card: Mapped[dict] = mapped_column(JSONB, default=dict)  # full serialised ComponentCard
    created_at = created_at_column()


class ComponentRole(Base):
    __tablename__ = "component_roles"
    id: Mapped[int] = mapped_column(primary_key=True)
    card_id: Mapped[int] = mapped_column(ForeignKey("component_cards.id"), index=True)
    role: Mapped[str] = mapped_column(String(64), index=True)


class ComponentInput(Base):
    __tablename__ = "component_inputs"
    id: Mapped[int] = mapped_column(primary_key=True)
    card_id: Mapped[int] = mapped_column(ForeignKey("component_cards.id"), index=True)
    name: Mapped[str] = mapped_column(String(255))
    provenance: Mapped[dict] = mapped_column(JSONB, default=dict)


class ComponentOutput(Base):
    __tablename__ = "component_outputs"
    id: Mapped[int] = mapped_column(primary_key=True)
    card_id: Mapped[int] = mapped_column(ForeignKey("component_cards.id"), index=True)
    name: Mapped[str] = mapped_column(String(255))
    provenance: Mapped[dict] = mapped_column(JSONB, default=dict)


class ComponentInterface(Base):
    __tablename__ = "component_interfaces"
    id: Mapped[int] = mapped_column(primary_key=True)
    card_id: Mapped[int] = mapped_column(ForeignKey("component_cards.id"), index=True)
    kind: Mapped[str] = mapped_column(String(64))


class Evidence(Base):
    __tablename__ = "evidence"
    id: Mapped[int] = mapped_column(primary_key=True)
    subject_type: Mapped[str] = mapped_column(String(64), index=True)
    subject_id: Mapped[int] = mapped_column(Integer, index=True)
    source: Mapped[str] = mapped_column(String(128))
    url: Mapped[str | None] = mapped_column(String(1024))
    detail: Mapped[str | None] = mapped_column(Text)
    confidence: Mapped[float] = mapped_column(Float, default=1.0)
    created_at = created_at_column()


class DiscoveryQuery(Base):
    __tablename__ = "discovery_queries"
    id: Mapped[int] = mapped_column(primary_key=True)
    term: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    family: Mapped[str | None] = mapped_column(String(255))
    # status: active | quarantine | retired
    status: Mapped[str] = mapped_column(String(32), default="active", index=True)
    relevant_hits: Mapped[int] = mapped_column(Integer, default=0)
    total_hits: Mapped[int] = mapped_column(Integer, default=0)
    cursor: Mapped[dict] = mapped_column(JSONB, default=dict)  # checkpoint state
    created_at = created_at_column()
    updated_at = updated_at_column()


class DiscoveryQueryRun(Base):
    __tablename__ = "discovery_query_runs"
    id: Mapped[int] = mapped_column(primary_key=True)
    query_id: Mapped[int] = mapped_column(ForeignKey("discovery_queries.id"), index=True)
    window_start: Mapped[str | None] = mapped_column(String(32))
    window_end: Mapped[str | None] = mapped_column(String(32))
    results: Mapped[int] = mapped_column(Integer, default=0)
    new_repos: Mapped[int] = mapped_column(Integer, default=0)
    api_calls: Mapped[int] = mapped_column(Integer, default=0)
    created_at = created_at_column()


class DiscoveredTerm(Base):
    __tablename__ = "discovered_terms"
    id: Mapped[int] = mapped_column(primary_key=True)
    term: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    source: Mapped[str] = mapped_column(String(128))  # topic|readme|dependency|awesome-list
    status: Mapped[str] = mapped_column(String(32), default="quarantine", index=True)
    relevant_hits: Mapped[int] = mapped_column(Integer, default=0)
    created_at = created_at_column()


class RepositoryLink(Base):
    __tablename__ = "repository_links"
    id: Mapped[int] = mapped_column(primary_key=True)
    repository_id: Mapped[int] = mapped_column(ForeignKey("repositories.id"), index=True)
    target: Mapped[str] = mapped_column(String(1024))
    kind: Mapped[str] = mapped_column(String(64))  # readme_link|dependency|submodule|related
    created_at = created_at_column()


class Embedding(Base):
    __tablename__ = "embeddings"
    id: Mapped[int] = mapped_column(primary_key=True)
    card_id: Mapped[int] = mapped_column(ForeignKey("component_cards.id"), index=True)
    model: Mapped[str] = mapped_column(String(128))
    dim: Mapped[int] = mapped_column(Integer)
    # Stored as JSONB fallback; the migration additionally creates a pgvector
    # column `vector` when the extension is available.
    vector_json: Mapped[list] = mapped_column(JSONB, default=list)
    created_at = created_at_column()


class CompatibilityEdgeRow(Base):
    __tablename__ = "compatibility_edges"
    id: Mapped[int] = mapped_column(primary_key=True)
    source_full_name: Mapped[str] = mapped_column(String(512), index=True)
    destination_full_name: Mapped[str] = mapped_column(String(512), index=True)
    output: Mapped[str] = mapped_column(String(255))
    input: Mapped[str] = mapped_column(String(255))
    interface: Mapped[str] = mapped_column(String(64))
    confidence: Mapped[float] = mapped_column(Float, default=0.0)
    required_adapter: Mapped[str | None] = mapped_column(String(255))
    integration_difficulty: Mapped[str] = mapped_column(String(32), default="unknown")
    licence_compatible: Mapped[bool | None] = mapped_column(Boolean)
    deployment_compatible: Mapped[bool | None] = mapped_column(Boolean)
    evidence: Mapped[list] = mapped_column(JSONB, default=list)
    created_at = created_at_column()
    __table_args__ = (
        UniqueConstraint(
            "source_full_name", "destination_full_name", "output", "input",
            name="uq_edge",
        ),
    )


class CombinationRow(Base):
    __tablename__ = "combinations"
    id: Mapped[int] = mapped_column(primary_key=True)
    combo_id: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    product_name: Mapped[str | None] = mapped_column(String(512))
    one_sentence: Mapped[str | None] = mapped_column(Text)
    technical_opportunity_score: Mapped[int] = mapped_column(Integer, default=0, index=True)
    is_ten_of_ten: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    fingerprint: Mapped[str] = mapped_column(String(64), index=True)  # dedup + change detection
    payload: Mapped[dict] = mapped_column(JSONB, default=dict)
    created_at = created_at_column()
    updated_at = updated_at_column()


class CombinationComponent(Base):
    __tablename__ = "combination_components"
    id: Mapped[int] = mapped_column(primary_key=True)
    combination_id: Mapped[int] = mapped_column(ForeignKey("combinations.id"), index=True)
    full_name: Mapped[str] = mapped_column(String(512), index=True)
    position: Mapped[int] = mapped_column(Integer, default=0)


class GateEvaluation(Base):
    __tablename__ = "gate_evaluations"
    id: Mapped[int] = mapped_column(primary_key=True)
    combination_id: Mapped[int] = mapped_column(ForeignKey("combinations.id"), index=True)
    gate: Mapped[int] = mapped_column(Integer)
    name: Mapped[str] = mapped_column(String(128))
    state: Mapped[str] = mapped_column(String(16))  # PASS|FAIL|UNKNOWN
    evidence: Mapped[list] = mapped_column(JSONB, default=list)
    contradictions: Mapped[list] = mapped_column(JSONB, default=list)
    unknowns: Mapped[list] = mapped_column(JSONB, default=list)
    created_at = created_at_column()


class Dossier(Base):
    __tablename__ = "dossiers"
    id: Mapped[int] = mapped_column(primary_key=True)
    dossier_id: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    combination_id: Mapped[int] = mapped_column(ForeignKey("combinations.id"), index=True)
    json_path: Mapped[str] = mapped_column(String(1024))
    markdown_path: Mapped[str] = mapped_column(String(1024))
    payload: Mapped[dict] = mapped_column(JSONB, default=dict)
    created_at = created_at_column()


class Alert(Base):
    __tablename__ = "alerts"
    id: Mapped[int] = mapped_column(primary_key=True)
    kind: Mapped[str] = mapped_column(String(64), index=True)
    dedup_key: Mapped[str] = mapped_column(String(255), index=True)
    body: Mapped[str] = mapped_column(Text)
    sent: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at = created_at_column()
    __table_args__ = (UniqueConstraint("dedup_key", name="uq_alert_dedup"),)


class Job(Base):
    __tablename__ = "jobs"
    id: Mapped[int] = mapped_column(primary_key=True)
    kind: Mapped[str] = mapped_column(String(64), index=True)
    payload: Mapped[dict] = mapped_column(JSONB, default=dict)
    status: Mapped[str] = mapped_column(String(32), default="pending", index=True)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    max_attempts: Mapped[int] = mapped_column(Integer, default=5)
    run_after: Mapped[datetime | None] = mapped_column(index=True)
    dedup_key: Mapped[str | None] = mapped_column(String(255), unique=True)
    last_error: Mapped[str | None] = mapped_column(Text)
    created_at = created_at_column()
    updated_at = updated_at_column()


class DeadLetterJob(Base):
    __tablename__ = "dead_letter_jobs"
    id: Mapped[int] = mapped_column(primary_key=True)
    kind: Mapped[str] = mapped_column(String(64), index=True)
    payload: Mapped[dict] = mapped_column(JSONB, default=dict)
    error: Mapped[str | None] = mapped_column(Text)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    created_at = created_at_column()


class SchedulerRun(Base):
    __tablename__ = "scheduler_runs"
    id: Mapped[int] = mapped_column(primary_key=True)
    task: Mapped[str] = mapped_column(String(128), index=True)
    started_at = created_at_column()
    finished_at: Mapped[datetime | None] = mapped_column()
    status: Mapped[str] = mapped_column(String(32), default="running")
    detail: Mapped[str | None] = mapped_column(Text)


class ApiUsage(Base):
    __tablename__ = "api_usage"
    id: Mapped[int] = mapped_column(primary_key=True)
    resource: Mapped[str] = mapped_column(String(64), index=True)
    calls: Mapped[int] = mapped_column(Integer, default=0)
    conditional_hits: Mapped[int] = mapped_column(Integer, default=0)
    window_start = created_at_column()


class SystemHealth(Base):
    __tablename__ = "system_health"
    id: Mapped[int] = mapped_column(primary_key=True)
    key: Mapped[str] = mapped_column(String(64), index=True)
    value: Mapped[dict] = mapped_column(JSONB, default=dict)
    created_at = created_at_column()


class UserFeedback(Base):
    __tablename__ = "user_feedback"
    id: Mapped[int] = mapped_column(primary_key=True)
    combination_id: Mapped[int] = mapped_column(ForeignKey("combinations.id"), index=True)
    label: Mapped[str] = mapped_column(String(64))  # interesting|not_interesting|already_exists|...
    note: Mapped[str | None] = mapped_column(Text)
    created_at = created_at_column()


class ModelRun(Base):
    __tablename__ = "model_runs"
    id: Mapped[int] = mapped_column(primary_key=True)
    model: Mapped[str] = mapped_column(String(128))
    prompt_version: Mapped[str] = mapped_column(String(64))
    input_hash: Mapped[str] = mapped_column(String(64), index=True)
    output: Mapped[dict] = mapped_column(JSONB, default=dict)
    valid: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at = created_at_column()


class PromptVersion(Base):
    __tablename__ = "prompt_versions"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(128), index=True)
    version: Mapped[str] = mapped_column(String(64))
    body: Mapped[str] = mapped_column(Text)
    created_at = created_at_column()
    __table_args__ = (UniqueConstraint("name", "version", name="uq_prompt_name_version"),)
