"""DB-backed discovery store: dedup, history snapshots, edge/card persistence."""


from sqlalchemy import func, select

from app.database.models import (
    CompatibilityEdgeRow,
    ComponentCardRow,
    Repository,
    RepositorySnapshot,
)
from app.database.store import DbDiscoveryStore, persist_card, persist_edge
from app.extraction.component_card import build_card_from_metadata
from app.matching.edges import build_edge
from app.models.schemas import Role
from tests.integration.conftest import requires_db

pytestmark = requires_db


def _repo(i):
    return {
        "id": i, "name": f"r{i}", "owner": {"login": "o"},
        "html_url": f"https://github.com/o/r{i}", "description": "tool",
        "license": {"spdx_id": "MIT"}, "stargazers_count": 100, "forks_count": 10,
        "open_issues_count": 2, "archived": False, "fork": False, "size": 900,
        "pushed_at": "2026-06-01T00:00:00Z", "language": "Python",
    }


def test_upsert_dedup_and_snapshots(pg_session):
    store = DbDiscoveryStore(pg_session)
    assert store.has_repo(1) is False
    assert store.upsert_repo(_repo(1), "accept", ["ok"]) is True
    assert store.upsert_repo(_repo(1), "accept", ["ok again"]) is False  # dedup: not new
    assert store.has_repo(1) is True
    # One repository row, two snapshots (history preserved).
    assert pg_session.scalar(select(func.count()).select_from(Repository)) == 1
    assert pg_session.scalar(select(func.count()).select_from(RepositorySnapshot)) == 2


def test_checkpoint_roundtrip(pg_session):
    store = DbDiscoveryStore(pg_session)
    assert store.get_checkpoint("ocr") == {}
    store.save_checkpoint("ocr", {"last_window_end": "2026-01-31"})
    assert store.get_checkpoint("ocr")["last_window_end"] == "2026-01-31"


def test_persist_card_and_edge(pg_session):
    store = DbDiscoveryStore(pg_session)
    store.upsert_repo(_repo(1), "accept", ["ok"])
    store.upsert_repo(_repo(2), "accept", ["ok"])
    a = build_card_from_metadata(_repo(1))
    a.outputs = ["text"]
    a.roles = [Role.parser]
    a.interfaces = ["python"]
    b = build_card_from_metadata(_repo(2))
    b.inputs = ["text"]
    b.roles = [Role.classifier]
    b.interfaces = ["python"]
    persist_card(pg_session, a)
    persist_card(pg_session, b)
    edge = build_edge(a, b)
    assert edge is not None
    persist_edge(pg_session, edge)
    persist_edge(pg_session, edge)  # idempotent upsert

    assert pg_session.scalar(select(func.count()).select_from(ComponentCardRow)) == 2
    assert pg_session.scalar(select(func.count()).select_from(CompatibilityEdgeRow)) == 1
    row = pg_session.scalar(select(ComponentCardRow))
    assert isinstance(row.card, dict)  # full card serialised as JSONB
