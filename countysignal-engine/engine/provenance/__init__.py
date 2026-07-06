"""Provenance primitives: content hashing and provenance payload assembly.

Every row that flows past raw ingestion carries enough provenance to be
traced back to a specific raw artifact, ingestion run, and source contract
version — and therefore to be rebuilt from scratch.
"""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from typing import Any


def content_hash(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def row_hash(record: dict[str, Any]) -> str:
    """Stable hash of a parsed record (order-independent)."""
    canonical = json.dumps(record, sort_keys=True, default=str, separators=(",", ":"))
    return hashlib.sha256(canonical.encode()).hexdigest()


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def build_provenance(
    *,
    source_id: str,
    source_version: str,
    ingestion_run_id: int | None,
    raw_artifact_id: int | None,
    source_record_id: str,
    source_row_hash: str,
    extra: dict | None = None,
) -> dict:
    p = {
        "source_id": source_id,
        "source_version": source_version,
        "ingestion_run_id": ingestion_run_id,
        "raw_artifact_id": raw_artifact_id,
        "source_record_id": source_record_id,
        "source_row_hash": source_row_hash,
    }
    if extra:
        p.update(extra)
    return p
