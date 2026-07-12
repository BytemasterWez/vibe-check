"""PostgreSQL-backed work queue with retries and a dead-letter table.

Claiming uses ``SELECT ... FOR UPDATE SKIP LOCKED`` so multiple workers never
grab the same job. Retry backoff and dead-lettering are pure functions so they
can be unit-tested without a database.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.database.models import DeadLetterJob, Job

logger = logging.getLogger("repoforge.jobs")

BASE_BACKOFF_SECONDS = 30
MAX_BACKOFF_SECONDS = 3600


def backoff_delay(attempts: int) -> int:
    """Exponential backoff, capped. attempts is the count *after* the failure."""
    if attempts <= 0:
        return BASE_BACKOFF_SECONDS
    return min(MAX_BACKOFF_SECONDS, BASE_BACKOFF_SECONDS * (2 ** (attempts - 1)))


def should_dead_letter(attempts: int, max_attempts: int) -> bool:
    return attempts >= max_attempts


class JobQueue:
    def __init__(self, session: Session) -> None:
        self._s = session

    def enqueue(
        self,
        kind: str,
        payload: dict,
        *,
        dedup_key: str | None = None,
        max_attempts: int = 5,
    ) -> Job | None:
        """Insert a job. If ``dedup_key`` already exists (pending/in-flight),
        returns None instead of creating a duplicate."""
        if dedup_key is not None:
            existing = self._s.scalar(select(Job).where(Job.dedup_key == dedup_key))
            if existing is not None:
                return None
        job = Job(
            kind=kind,
            payload=payload,
            status="pending",
            max_attempts=max_attempts,
            dedup_key=dedup_key,
            run_after=datetime.now(UTC),
        )
        self._s.add(job)
        self._s.flush()
        return job

    def claim(self, kinds: list[str] | None = None) -> Job | None:
        """Atomically claim the next due job, skipping rows locked by others."""
        now = datetime.now(UTC)
        clause = "status = 'pending' AND (run_after IS NULL OR run_after <= :now)"
        params: dict[str, object] = {"now": now}
        if kinds:
            clause += " AND kind = ANY(:kinds)"
            params["kinds"] = kinds
        row = self._s.execute(
            text(
                f"SELECT id FROM jobs WHERE {clause} "  # noqa: S608 - clause is static
                "ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1"
            ),
            params,
        ).first()
        if row is None:
            return None
        job = self._s.get(Job, row[0])
        if job is None:
            return None
        job.status = "running"
        job.attempts += 1
        self._s.flush()
        return job

    def complete(self, job: Job) -> None:
        job.status = "done"
        job.last_error = None
        self._s.flush()

    def fail(self, job: Job, error: str) -> str:
        """Record a failure. Returns 'retry' or 'dead_letter'."""
        job.last_error = error[:2000]
        if should_dead_letter(job.attempts, job.max_attempts):
            self._s.add(
                DeadLetterJob(
                    kind=job.kind,
                    payload=job.payload,
                    error=error[:2000],
                    attempts=job.attempts,
                )
            )
            self._s.delete(job)
            self._s.flush()
            logger.error("job %s dead-lettered after %d attempts", job.kind, job.attempts)
            return "dead_letter"
        delay = backoff_delay(job.attempts)
        job.status = "pending"
        job.run_after = datetime.now(UTC) + timedelta(seconds=delay)
        self._s.flush()
        logger.warning("job %s retry in %ds (attempt %d)", job.kind, delay, job.attempts)
        return "retry"
