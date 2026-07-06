"""Source adapter interface.

Every source is added by (1) a source contract under contracts/sources/ and
(2) an adapter implementing this interface. Adapters must be idempotent:
re-running any stage with the same inputs produces no duplicates (raw
artifacts dedupe on content hash; src rows dedupe on source_record_id +
row hash; norm rows dedupe on their natural key).

Adapters support: dry run, limited sample run, full refresh, incremental
refresh (where possible), retry with backoff, rate-limit awareness, schema
drift detection, row count validation, raw artifact hashing, and source
version tagging (from the contract hash).
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

import httpx
from tenacity import retry, stop_after_attempt, wait_exponential

from engine.config import FIXTURES_DIR, Settings, get_settings
from engine.contracts import SourceContract, VariableContract
from engine.normalisation.normalise import ParsedRecord
from engine.provenance import utcnow
from engine.validation import ValidationReport, validate_source_batch


@dataclass
class RunContext:
    mode: str = "full"                      # dry_run | sample | full | incremental
    limit: Optional[int] = None             # cap parsed records (sample runs)
    since: Optional[str] = None             # incremental watermark, adapter-defined
    settings: Settings = field(default_factory=get_settings)
    fixtures_dir: Path = FIXTURES_DIR
    params: dict[str, Any] = field(default_factory=dict)


@dataclass
class RawArtifact:
    filename: str
    data: bytes
    source_url: str
    request_params: dict[str, Any] = field(default_factory=dict)
    content_type: str = "text/plain"
    record_count_claimed: Optional[int] = None
    retrieved_at: datetime = field(default_factory=utcnow)


@dataclass
class ParsedBatch:
    records: list[ParsedRecord]
    observed_fields: list[str]


@dataclass
class LoadReport:
    table: str
    attempted: int
    loaded: int
    skipped_existing: int = 0


@dataclass
class NormalizationReport:
    observations: int
    quarantined: int
    join_match_rate: float


class SourceAdapter(ABC):
    """One adapter per upstream source. source_id must match the contract."""

    source_id: str = ""

    def __init__(self, contract: SourceContract, variables: dict[str, VariableContract]):
        if contract.source_id != self.source_id:
            raise ValueError(
                f"adapter {type(self).__name__} is for '{self.source_id}' "
                f"but was given contract '{contract.source_id}'"
            )
        self.contract = contract
        self.variables = variables

    # -- lifecycle stages ---------------------------------------------------

    @abstractmethod
    def fetch(self, run_context: RunContext) -> RawArtifact:
        """Retrieve raw bytes from the official access method (or the bundled
        sample fixture when run_context.mode == 'sample')."""

    @abstractmethod
    def parse(self, raw_artifact: RawArtifact) -> ParsedBatch:
        """Parse raw bytes into ParsedRecords (no geography joining here)."""

    def validate(self, parsed_batch: ParsedBatch) -> ValidationReport:
        return validate_source_batch(
            self.contract, parsed_batch.records, parsed_batch.observed_fields
        )

    def src_row(self, record: ParsedRecord) -> dict[str, Any]:
        """Map a ParsedRecord to one src.* table row (source-native fields).
        Implement this OR src_rows (for long/one-row-per-variable tables)."""
        raise NotImplementedError

    def src_rows(self, record: ParsedRecord) -> list[dict[str, Any]]:
        """Map a ParsedRecord to src.* rows. Rows may carry their own
        source_record_id when one ParsedRecord expands to several rows;
        otherwise the runner fills in the record's id and hash."""
        return [self.src_row(record)]

    # normalize() is provided by the runner via engine.normalisation — the
    # adapter only declares parsing and src mapping. Adapters may override
    # sample_fixture() to point at their bundled sample.

    def sample_fixture(self, run_context: RunContext) -> Path:
        return run_context.fixtures_dir / f"{self.source_id}_sample.csv"

    # -- shared helpers -------------------------------------------------------

    @retry(stop=stop_after_attempt(4), wait=wait_exponential(multiplier=2, min=2, max=30))
    def _http_get(self, url: str, *, params: dict | None = None,
                  timeout: float = 120.0) -> httpx.Response:
        """GET with retry/backoff. Adapters must respect upstream rate limits:
        pass rate_limit_sleep in RunContext.params for throttled sources."""
        headers = {"User-Agent": "CountySignalEngine/0.1 (data pipeline; contact via repo)"}
        resp = httpx.get(url, params=params, timeout=timeout,
                         headers=headers, follow_redirects=True)
        resp.raise_for_status()
        return resp

    def _fixture_artifact(self, run_context: RunContext, *, content_type: str) -> RawArtifact:
        path = self.sample_fixture(run_context)
        return RawArtifact(
            filename=path.name,
            data=path.read_bytes(),
            source_url=f"fixture://{path.name}",
            request_params={"mode": "sample"},
            content_type=content_type,
        )
