"""PostgreSQL advisory locks so only one copy of a scheduled task runs at once."""

from __future__ import annotations

import hashlib
from contextlib import contextmanager

from sqlalchemy import text
from sqlalchemy.orm import Session


def _lock_key(name: str) -> int:
    """Deterministic signed 64-bit key from a task name."""
    digest = hashlib.sha256(name.encode()).digest()[:8]
    val = int.from_bytes(digest, "big", signed=False)
    # Fit into a signed 64-bit range for pg_advisory_lock.
    return val - (1 << 63)


def try_advisory_lock(session: Session, name: str) -> bool:
    """Non-blocking. Returns True if the lock was acquired."""
    key = _lock_key(name)
    result = session.execute(text("SELECT pg_try_advisory_lock(:k)"), {"k": key})
    return bool(result.scalar())


def advisory_unlock(session: Session, name: str) -> bool:
    key = _lock_key(name)
    result = session.execute(text("SELECT pg_advisory_unlock(:k)"), {"k": key})
    return bool(result.scalar())


@contextmanager
def advisory_lock(session: Session, name: str):
    """Context manager yielding whether the lock was acquired. Always releases."""
    acquired = try_advisory_lock(session, name)
    try:
        yield acquired
    finally:
        if acquired:
            advisory_unlock(session, name)
