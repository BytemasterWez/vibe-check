"""API service plumbing: auth, rate limiting, request IDs, usage logging,
structured errors, pagination. The API reads exclusively from api.* views
via the read-only role (CSE_API_DATABASE_URL); its only write surface is
audit.api_usage."""

from __future__ import annotations

import hashlib
import time
import uuid
from collections import deque

from fastapi import HTTPException, Query, Request
from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine

from engine.config import get_settings

_engine: Engine | None = None


def api_engine() -> Engine:
    global _engine
    if _engine is None:
        settings = get_settings()
        url = settings.api_database_url or settings.database_url
        _engine = create_engine(url, pool_pre_ping=True)
    return _engine


def query_rows(sql: str, **params) -> list[dict]:
    with api_engine().connect() as conn:
        return [dict(r._mapping) for r in conn.execute(text(sql), params)]


# --- auth ------------------------------------------------------------------

def require_api_key(request: Request) -> str:
    settings = get_settings()
    key = request.headers.get("X-API-Key", "")
    if not settings.api_keys:
        raise HTTPException(503, detail=structured_error(
            request, "api_keys_unconfigured", "CSE_API_KEYS is not configured"))
    if key not in settings.api_keys:
        raise HTTPException(401, detail=structured_error(
            request, "invalid_api_key", "missing or invalid X-API-Key header"))
    _rate_limit(request, key)
    return key


# --- rate limiting -----------------------------------------------------------
# Per-key sliding window, in-process. With multiple API replicas move this to
# Redis (CSE_REDIS_URL); the interface stays the same.

_windows: dict[str, deque] = {}


def _rate_limit(request: Request, key: str) -> None:
    limit = get_settings().rate_limit_per_minute
    now = time.monotonic()
    window = _windows.setdefault(key, deque())
    while window and now - window[0] > 60:
        window.popleft()
    if len(window) >= limit:
        raise HTTPException(429, detail=structured_error(
            request, "rate_limited", f"rate limit {limit}/min exceeded"))
    window.append(now)


# --- request ids / structured errors ----------------------------------------

def new_request_id() -> str:
    return uuid.uuid4().hex


def structured_error(request: Request, code: str, message: str) -> dict:
    return {
        "error": code,
        "message": message,
        "request_id": getattr(request.state, "request_id", None),
    }


def log_usage(request: Request, status_code: int, duration_ms: float) -> None:
    key = request.headers.get("X-API-Key", "")
    key_hash = hashlib.sha256(key.encode()).hexdigest()[:16] if key else None
    try:
        with api_engine().begin() as conn:
            conn.execute(
                text(
                    """INSERT INTO audit.api_usage
                       (request_id, api_key_hash, method, path, status_code, duration_ms)
                       VALUES (:rid, :kh, :m, :p, :sc, :d)"""
                ),
                {"rid": getattr(request.state, "request_id", ""), "kh": key_hash,
                 "m": request.method, "p": request.url.path, "sc": status_code,
                 "d": duration_ms},
            )
    except Exception:   # usage logging must never break a request
        pass


# --- pagination --------------------------------------------------------------

def pagination(
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
) -> dict:
    return {"limit": limit, "offset": offset}
