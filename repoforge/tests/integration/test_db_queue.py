"""Job-queue retry and dead-letter behaviour against a real PostgreSQL."""

from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select, update

from app.database.models import DeadLetterJob, Job
from app.scheduler.jobs import JobQueue
from tests.integration.conftest import requires_db

pytestmark = requires_db


def test_enqueue_dedup(pg_session):
    q = JobQueue(pg_session)
    first = q.enqueue("classify", {"repo": "a/b"}, dedup_key="a/b")
    second = q.enqueue("classify", {"repo": "a/b"}, dedup_key="a/b")
    assert first is not None
    assert second is None  # deduplicated
    assert pg_session.scalar(select(func.count()).select_from(Job)) == 1


def test_claim_marks_running_and_increments_attempts(pg_session):
    q = JobQueue(pg_session)
    q.enqueue("classify", {"n": 1})
    job = q.claim(["classify"])
    assert job is not None
    assert job.status == "running"
    assert job.attempts == 1


def test_retry_then_dead_letter(pg_session):
    q = JobQueue(pg_session)
    q.enqueue("classify", {"n": 1}, max_attempts=3)

    outcomes = []
    for _ in range(3):
        # Make the retried job immediately due again.
        pg_session.execute(update(Job).values(run_after=datetime.now(UTC)
                                              - timedelta(seconds=1)))
        pg_session.flush()
        job = q.claim(["classify"])
        assert job is not None
        outcomes.append(q.fail(job, "boom"))

    assert outcomes == ["retry", "retry", "dead_letter"]
    assert pg_session.scalar(select(func.count()).select_from(Job)) == 0
    dl = pg_session.scalar(select(DeadLetterJob))
    assert dl is not None
    assert dl.attempts == 3
    assert dl.error == "boom"


def test_complete_marks_done(pg_session):
    q = JobQueue(pg_session)
    q.enqueue("classify", {"n": 1})
    job = q.claim(["classify"])
    q.complete(job)
    assert job.status == "done"


def test_claim_returns_none_when_empty(pg_session):
    q = JobQueue(pg_session)
    assert q.claim(["classify"]) is None
