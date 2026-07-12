"""APScheduler wiring with PostgreSQL advisory-lock guarding.

Every scheduled task runs inside ``run_guarded``: it acquires a named advisory
lock so only one copy runs across all processes, records a scheduler_runs row,
and always releases the lock. If the lock is already held, the tick is skipped
cleanly (not queued, not failed).
"""

from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from sqlalchemy.orm import Session, sessionmaker

from app.config import Settings
from app.database.models import SchedulerRun
from app.reliability.locks import advisory_lock
from app.scheduler.tasks import discovery_tick

logger = logging.getLogger("repoforge.scheduler")

TaskFn = Callable[[Session, Settings], Awaitable[dict]]


async def run_guarded(
    factory: sessionmaker[Session],
    settings: Settings,
    task_name: str,
    task: TaskFn,
) -> dict:
    """Run ``task`` under an advisory lock. Returns a result/skip dict."""
    session = factory()
    try:
        with advisory_lock(session, task_name) as acquired:
            if not acquired:
                logger.info("scheduler: '%s' already running elsewhere; skipping", task_name)
                return {"task": task_name, "skipped": "locked"}
            run = SchedulerRun(task=task_name, status="running")
            session.add(run)
            session.flush()
            try:
                result = await task(session, settings)
                run.status = "ok"
                run.detail = str(result)[:1000]
            except Exception as exc:  # noqa: BLE001 - record + re-raise controlled
                run.status = "error"
                run.detail = str(exc)[:1000]
                logger.exception("scheduler task '%s' failed", task_name)
                result = {"task": task_name, "error": str(exc)}
            run.finished_at = datetime.now(UTC)
            session.commit()
            return result
    finally:
        session.close()


def build_scheduler(settings: Settings, factory: sessionmaker[Session]) -> AsyncIOScheduler:
    """Create (but do not start) the scheduler with registered jobs."""
    scheduler = AsyncIOScheduler(timezone=settings.timezone)

    async def _discovery_job() -> None:
        await run_guarded(factory, settings, "discovery_tick", discovery_tick)

    # Rotating discovery: one term every few minutes keeps well under the budget.
    scheduler.add_job(
        _discovery_job,
        trigger="interval",
        minutes=5,
        id="discovery_tick",
        max_instances=1,
        coalesce=True,
        replace_existing=True,
    )
    return scheduler
