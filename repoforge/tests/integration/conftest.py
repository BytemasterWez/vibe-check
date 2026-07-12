"""Shared fixtures for DB-backed integration tests.

These tests need a real PostgreSQL (advisory locks, FOR UPDATE SKIP LOCKED, and
pgvector are Postgres-specific). They are skipped automatically unless
``REPOFORGE_TEST_DATABASE_URL`` points at a reachable database, so the default
``make test`` stays green without infrastructure.
"""

from __future__ import annotations

import os

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import NullPool

import app.database.models  # noqa: F401  (register tables)
from app.database.base import Base

TEST_DB_URL = os.environ.get("REPOFORGE_TEST_DATABASE_URL")


def _reachable(url: str) -> bool:
    try:
        eng = create_engine(url)
        with eng.connect() as conn:
            conn.execute(text("SELECT 1"))
        eng.dispose()
        return True
    except Exception:
        return False


requires_db = pytest.mark.skipif(
    not TEST_DB_URL or not _reachable(TEST_DB_URL),
    reason="REPOFORGE_TEST_DATABASE_URL not set or database unreachable",
)


@pytest.fixture(scope="session")
def pg_engine():
    assert TEST_DB_URL
    # NullPool: every session gets a fresh connection, so closing it ends the DB
    # session and releases any session-level advisory locks (no cross-test leaks).
    engine = create_engine(TEST_DB_URL, future=True, poolclass=NullPool)
    with engine.begin() as conn:
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    yield engine
    engine.dispose()


@pytest.fixture
def pg_session(pg_engine):
    """A session wrapped in a transaction that is rolled back after each test."""
    factory = sessionmaker(bind=pg_engine, future=True)
    session = factory()
    # Clean slate per test for the tables these tests touch.
    session.execute(text("TRUNCATE jobs, dead_letter_jobs, scheduler_runs, "
                         "repositories, repository_snapshots, discovery_queries, "
                         "compatibility_edges RESTART IDENTITY CASCADE"))
    session.commit()
    try:
        yield session
    finally:
        session.rollback()
        session.close()
