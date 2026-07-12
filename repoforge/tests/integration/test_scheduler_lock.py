"""Advisory-lock scheduler guarding against a real PostgreSQL."""

from sqlalchemy import func, select
from sqlalchemy.orm import sessionmaker

from app.config import Settings
from app.database.models import SchedulerRun
from app.reliability.locks import advisory_lock, advisory_unlock, try_advisory_lock
from app.scheduler.scheduler import run_guarded
from tests.integration.conftest import requires_db

pytestmark = requires_db


def test_second_holder_cannot_acquire_same_lock(pg_engine):
    factory = sessionmaker(bind=pg_engine, future=True)
    s1, s2 = factory(), factory()
    try:
        with advisory_lock(s1, "discovery_tick") as got1:
            assert got1 is True
            # A different connection must NOT get the same lock.
            assert try_advisory_lock(s2, "discovery_tick") is False
        # After release, it becomes available again.
        assert try_advisory_lock(s2, "discovery_tick") is True
        advisory_unlock(s2, "discovery_tick")
    finally:
        s1.close()
        s2.close()


async def test_run_guarded_skips_when_locked(pg_engine):
    factory = sessionmaker(bind=pg_engine, future=True)
    settings = Settings()
    holder = factory()
    try:
        # Hold the lock so run_guarded must skip.
        assert try_advisory_lock(holder, "discovery_tick") is True

        async def task(session, cfg):
            return {"ran": True}

        result = await run_guarded(factory, settings, "discovery_tick", task)
        assert result == {"task": "discovery_tick", "skipped": "locked"}
    finally:
        holder.close()


async def test_run_guarded_runs_and_records_when_free(pg_engine):
    factory = sessionmaker(bind=pg_engine, future=True)
    settings = Settings()

    async def task(session, cfg):
        return {"ran": True, "count": 42}

    result = await run_guarded(factory, settings, "discovery_tick", task)
    assert result == {"ran": True, "count": 42}

    check = factory()
    try:
        runs = check.scalar(select(func.count()).select_from(SchedulerRun))
        row = check.scalar(select(SchedulerRun).order_by(SchedulerRun.id.desc()))
        assert runs >= 1
        assert row.status == "ok"
    finally:
        check.close()
