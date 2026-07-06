"""Database access. The engine services use the read-write role; the API
service must be given the read-only role (CSE_API_DATABASE_URL)."""

from __future__ import annotations

from contextlib import contextmanager
from typing import Iterator

from sqlalchemy import create_engine, text
from sqlalchemy.engine import Connection, Engine

from engine.config import get_settings

_engine: Engine | None = None


def get_engine(url: str | None = None) -> Engine:
    global _engine
    if url is not None:
        return create_engine(url, pool_pre_ping=True)
    if _engine is None:
        _engine = create_engine(get_settings().database_url, pool_pre_ping=True)
    return _engine


@contextmanager
def db_conn(url: str | None = None) -> Iterator[Connection]:
    engine = get_engine(url)
    with engine.begin() as conn:
        yield conn


def fetch_all(conn: Connection, sql: str, **params) -> list[dict]:
    rows = conn.execute(text(sql), params)
    return [dict(r._mapping) for r in rows]


def fetch_one(conn: Connection, sql: str, **params) -> dict | None:
    rows = fetch_all(conn, sql, **params)
    return rows[0] if rows else None


def execute(conn: Connection, sql: str, **params) -> None:
    conn.execute(text(sql), params)
