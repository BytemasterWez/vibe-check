"""Pydantic domain models — the validated contracts passed between engine stages.

These are deliberately separate from the SQLAlchemy ORM models: the ORM is the
storage shape, these are the in-memory shapes that carry provenance and are
validated at every boundary (including untrusted LLM output).
"""

from __future__ import annotations

from datetime import UTC, datetime
from enum import Enum

from pydantic import BaseModel, Field


def utcnow() -> datetime:
    return datetime.now(UTC)


# --------------------------------------------------------------------------- #
# Provenance
# --------------------------------------------------------------------------- #
class Provenance(BaseModel):
    """Where a fact came from. Every factual field must carry one of these."""

    source: str  # e.g. "github_api:repos", "readme", "llm:classifier"
    detail: str | None = None
    url: str | None = None
    confidence: float = Field(default=1.0, ge=0.0, le=1.0)
    extracted_at: datetime = Field(default_factory=utcnow)


class Fact(BaseModel):
    """A value plus its provenance. `value` may be None (= unknown)."""

    value: object | None = None
    provenance: Provenance

    @property
    def known(self) -> bool:
        return self.value is not None


# --------------------------------------------------------------------------- #
# Licensing
# --------------------------------------------------------------------------- #
class LicenceClass(str, Enum):
    permissive_commercial = "permissive_commercial"
    conditional_commercial = "conditional_commercial"
    strong_copyleft = "strong_copyleft"
    source_available = "source_available"
    non_commercial = "non_commercial"
    unknown = "unknown"
    conflicting = "conflicting"


class LicenceEvidence(BaseModel):
    spdx_id: str | None = None
    licence_class: LicenceClass = LicenceClass.unknown
    licence_file_url: str | None = None
    text_sha256: str | None = None
    detection_method: str = "unknown"
    confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    commercial_use: bool | None = None  # None = unknown, never silently True
    redistribution_notes: str | None = None
    network_copyleft: bool | None = None
    required_notices: list[str] = Field(default_factory=list)
    verified_at: datetime = Field(default_factory=utcnow)

    @property
    def commercially_safe(self) -> bool:
        """Only permissive/conditional with an explicit commercial_use=True."""
        return (
            self.commercial_use is True
            and self.licence_class
            in {LicenceClass.permissive_commercial, LicenceClass.conditional_commercial}
        )


# --------------------------------------------------------------------------- #
# Functional roles
# --------------------------------------------------------------------------- #
class Role(str, Enum):
    observer = "observer"
    collector = "collector"
    ingestor = "ingestor"
    parser = "parser"
    transformer = "transformer"
    classifier = "classifier"
    reasoner = "reasoner"
    optimiser = "optimiser"
    validator = "validator"
    knowledge_store = "knowledge_store"
    vector_store = "vector_store"
    graph_store = "graph_store"
    orchestrator = "orchestrator"
    security_layer = "security_layer"
    interface = "interface"
    reporter = "reporter"
    automation = "automation"
    deployment = "deployment"


# --------------------------------------------------------------------------- #
# Component card
# --------------------------------------------------------------------------- #
class DeploymentProfile(BaseModel):
    docker_available: bool | None = None
    cpu_only_capable: bool | None = None
    gpu_required: bool | None = None
    min_ram_mb: int | None = None
    storage_notes: str | None = None
    network_required: bool | None = None
    offline_capable: bool | None = None
    supported_os: list[str] = Field(default_factory=list)


class ComponentCard(BaseModel):
    owner: str
    repo: str
    canonical_url: str
    repository_id: int
    commit_sha: str | None = None
    release: str | None = None
    description: str | None = None

    capability_summary: str | None = None
    roles: list[Role] = Field(default_factory=list)
    inputs: list[str] = Field(default_factory=list)
    outputs: list[str] = Field(default_factory=list)
    interfaces: list[str] = Field(default_factory=list)  # e.g. cli, rest, python, grpc
    languages: list[str] = Field(default_factory=list)
    runtime_dependencies: list[str] = Field(default_factory=list)

    deployment: DeploymentProfile = Field(default_factory=DeploymentProfile)
    licence: LicenceEvidence = Field(default_factory=LicenceEvidence)

    # Maintenance / test / security evidence
    stars: int = 0
    forks: int = 0
    open_issues: int = 0
    archived: bool = False
    pushed_at: datetime | None = None
    has_tests: bool | None = None
    has_ci: bool | None = None

    maturity_score: float = 0.0
    integration_score: float = 0.0
    packaging_gap_score: float = 0.0
    known_limitations: list[str] = Field(default_factory=list)

    evidence_urls: list[str] = Field(default_factory=list)
    extraction_confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    model_version: str | None = None
    prompt_version: str | None = None
    extracted_at: datetime = Field(default_factory=utcnow)

    model_config = {"protected_namespaces": ()}


# --------------------------------------------------------------------------- #
# Compatibility & combinations
# --------------------------------------------------------------------------- #
class CompatibilityEdge(BaseModel):
    source: str  # "owner/repo"
    destination: str
    output: str
    input: str
    interface: str
    conversion_method: str | None = None
    confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    required_adapter: str | None = None
    integration_difficulty: str = "unknown"  # low | medium | high | unknown
    licence_compatible: bool | None = None
    deployment_compatible: bool | None = None
    evidence: list[str] = Field(default_factory=list)


class GateState(str, Enum):
    PASS = "PASS"
    FAIL = "FAIL"
    UNKNOWN = "UNKNOWN"


class GateResult(BaseModel):
    gate: int
    name: str
    state: GateState
    evidence: list[str] = Field(default_factory=list)
    contradictions: list[str] = Field(default_factory=list)
    unknowns: list[str] = Field(default_factory=list)


class Combination(BaseModel):
    combo_id: str
    components: list[str]  # ordered "owner/repo"
    edges: list[CompatibilityEdge] = Field(default_factory=list)
    product_name: str | None = None
    one_sentence: str | None = None
    created_at: datetime = Field(default_factory=utcnow)


class ScoredCombination(BaseModel):
    combination: Combination
    gates: list[GateResult]

    @property
    def passed_count(self) -> int:
        return sum(1 for g in self.gates if g.state is GateState.PASS)

    @property
    def is_ten_of_ten(self) -> bool:
        """Ten PASS results, no averaging. UNKNOWN is never PASS."""
        return len(self.gates) == 10 and all(g.state is GateState.PASS for g in self.gates)

    @property
    def technical_opportunity_score(self) -> int:
        return self.passed_count
