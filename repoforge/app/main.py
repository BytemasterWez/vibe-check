"""FastAPI application: health/readiness/metrics API + minimal dashboard.

Mutation endpoints require the admin token (``X-Admin-Token`` header). The
dashboard uses Jinja2 with autoescaping so untrusted repository content is HTML
escaped. Secrets are never rendered.
"""

from __future__ import annotations

import contextlib
import logging
from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse, PlainTextResponse
from jinja2 import Environment, PackageLoader, select_autoescape
from sqlalchemy import text

from app.config import Mode, Settings, get_settings
from app.reliability.preflight import CheckStatus, run_preflight

logger = logging.getLogger("repoforge.api")


@contextlib.asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Start the background scheduler if the DB is reachable and mode != paused."""
    settings = get_settings()
    app.state.scheduler = None
    if settings.repoforge_mode is Mode.paused:
        logger.info("mode=paused: scheduler not started")
    else:
        try:
            from app.database.session import get_session_factory
            from app.scheduler.scheduler import build_scheduler

            factory = get_session_factory()
            # Fail fast if the DB is unreachable; don't start a doomed scheduler.
            with factory() as probe:
                probe.execute(text("SELECT 1"))
            scheduler = build_scheduler(settings, factory)
            scheduler.start()
            app.state.scheduler = scheduler
            logger.info("scheduler started")
        except Exception as exc:  # noqa: BLE001 - startup must not crash the API
            logger.warning("scheduler not started: %s", exc)
    try:
        yield
    finally:
        sched = getattr(app.state, "scheduler", None)
        if sched is not None:
            sched.shutdown(wait=False)
            logger.info("scheduler stopped")


app = FastAPI(title="RepoForge", version="0.1.0", lifespan=lifespan)

_jinja = Environment(
    loader=PackageLoader("app.dashboard", "templates"),
    autoescape=select_autoescape(["html"]),
)


def get_config() -> Settings:
    return get_settings()


def require_admin(
    settings: Annotated[Settings, Depends(get_config)],
    x_admin_token: Annotated[str | None, Header()] = None,
) -> None:
    if not settings.admin_token:
        raise HTTPException(status_code=503, detail="admin token not configured")
    if x_admin_token != settings.admin_token:
        raise HTTPException(status_code=401, detail="invalid admin token")


def _db_ready(settings: Settings) -> tuple[bool, str]:
    try:
        from app.database.session import get_engine

        with get_engine().connect() as conn:
            conn.execute(text("SELECT 1"))
        return True, "ok"
    except Exception as exc:  # noqa: BLE001 - readiness must never raise
        return False, str(exc)[:200]


@app.get("/health", response_class=JSONResponse)
def health() -> dict:
    """Liveness: the process is up. Never touches external systems."""
    return {"status": "ok", "service": "repoforge"}


@app.get("/ready", response_class=JSONResponse)
def ready(settings: Annotated[Settings, Depends(get_config)]) -> JSONResponse:
    """Readiness: preflight + DB connectivity. 503 if not ready."""
    checks = run_preflight(settings.repoforge_data_dir, settings.min_free_disk_gb)
    db_ok, db_detail = _db_ready(settings)
    blocking = [c for c in checks if c.status is CheckStatus.FAIL]
    ready_ok = db_ok and not blocking
    body = {
        "ready": ready_ok,
        "mode": settings.repoforge_mode.value,
        "database": {"ok": db_ok, "detail": db_detail},
        "preflight": [
            {"name": c.name, "status": c.status.value, "detail": c.detail} for c in checks
        ],
    }
    return JSONResponse(body, status_code=200 if ready_ok else 503)


@app.get("/api/metrics", response_class=JSONResponse)
def metrics(settings: Annotated[Settings, Depends(get_config)]) -> dict:
    db_ok, _ = _db_ready(settings)
    counts: dict[str, int] = {}
    if db_ok:
        try:
            from app.database.session import get_engine

            tables = [
                "repositories",
                "component_cards",
                "compatibility_edges",
                "combinations",
                "dossiers",
                "jobs",
                "dead_letter_jobs",
            ]
            with get_engine().connect() as conn:
                for t in tables:
                    counts[t] = int(
                        conn.execute(text(f"SELECT count(*) FROM {t}")).scalar() or 0  # noqa: S608
                    )
        except Exception as exc:  # noqa: BLE001
            counts = {"error": 0}
            logger.warning("metrics query failed: %s", exc)
    return {"mode": settings.repoforge_mode.value, "counts": counts}


@app.get("/api/config", response_class=JSONResponse)
def config_status(settings: Annotated[Settings, Depends(get_config)]) -> dict:
    """Configuration surface with secrets redacted."""
    return settings.safe_status()


@app.get("/api/scheduler/status", response_class=JSONResponse)
def scheduler_status(settings: Annotated[Settings, Depends(get_config)]) -> dict:
    sched = getattr(app.state, "scheduler", None)
    running = bool(sched and sched.running)
    jobs = []
    if sched is not None:
        for job in sched.get_jobs():
            nxt = getattr(job, "next_run_time", None)
            jobs.append({"id": job.id, "next_run": nxt.isoformat() if nxt else None})
    recent: list[dict] = []
    try:
        from app.database.session import get_engine

        with get_engine().connect() as conn:
            rows = conn.execute(
                text(
                    "SELECT task, status, detail, started_at FROM scheduler_runs "
                    "ORDER BY id DESC LIMIT 10"
                )
            )
            recent = [
                {"task": r[0], "status": r[1], "detail": r[2],
                 "started_at": r[3].isoformat() if r[3] else None}
                for r in rows
            ]
    except Exception as exc:  # noqa: BLE001
        logger.debug("scheduler_status recent query failed: %s", exc)
    return {"running": running, "mode": settings.repoforge_mode.value,
            "jobs": jobs, "recent_runs": recent}


@app.post("/api/rescan", dependencies=[Depends(require_admin)])
async def manual_rescan(settings: Annotated[Settings, Depends(get_config)]) -> dict:
    """Run one discovery tick now (mutation; admin-only), under the same
    advisory lock as the scheduled job so it can't overlap."""
    if settings.repoforge_mode is Mode.paused:
        return {"queued": False, "reason": "paused"}
    try:
        from app.database.session import get_session_factory
        from app.scheduler.scheduler import run_guarded
        from app.scheduler.tasks import discovery_tick

        factory = get_session_factory()
        result = await run_guarded(factory, settings, "discovery_tick", discovery_tick)
        return {"queued": True, "result": result}
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=503, detail=f"rescan failed: {exc}") from exc


@app.post("/api/feedback", dependencies=[Depends(require_admin)])
async def submit_feedback(request: Request) -> dict:
    payload = await request.json()
    label = str(payload.get("label", "")).strip()
    allowed = {
        "interesting", "not_interesting", "already_exists", "technically_implausible",
        "licence_problem", "no_buyer", "too_expensive", "revisit_later",
    }
    if label not in allowed:
        raise HTTPException(status_code=422, detail=f"label must be one of {sorted(allowed)}")
    return {"recorded": True, "label": label}


# --------------------------------------------------------------------------- #
# Dashboard
# --------------------------------------------------------------------------- #
@app.get("/", response_class=HTMLResponse)
def dashboard_home(settings: Annotated[Settings, Depends(get_config)]) -> HTMLResponse:
    db_ok, db_detail = _db_ready(settings)
    checks = run_preflight(settings.repoforge_data_dir, settings.min_free_disk_gb)
    template = _jinja.get_template("index.html")
    html = template.render(
        mode=settings.repoforge_mode.value,
        paused=settings.repoforge_mode is Mode.paused,
        db_ok=db_ok,
        db_detail=db_detail,
        config=settings.safe_status(),
        checks=[{"name": c.name, "status": c.status.value, "detail": c.detail} for c in checks],
        port=settings.repoforge_port,
    )
    return HTMLResponse(html)


@app.get("/robots.txt", response_class=PlainTextResponse)
def robots() -> str:
    return "User-agent: *\nDisallow: /\n"
