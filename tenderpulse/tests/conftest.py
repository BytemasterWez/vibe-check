import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture()
def fresh_db(tmp_path, monkeypatch):
    """Point the app at a throwaway SQLite database for each test."""
    from app import config, db

    monkeypatch.setattr(config, "DATA_DIR", tmp_path)
    monkeypatch.setattr(config, "RAW_DIR", tmp_path / "raw")
    monkeypatch.setattr(config, "EXPORT_DIR", tmp_path / "exports")
    monkeypatch.setattr(config, "REPORT_DIR", tmp_path / "reports")
    db.reset_for_tests(f"sqlite:///{tmp_path / 'test.db'}")
    yield
    db._engine = None
    db._SessionLocal = None


@pytest.fixture()
def cf_releases():
    return json.loads((FIXTURES / "cf_sample.json").read_text())["releases"]


@pytest.fixture()
def fts_releases():
    return json.loads((FIXTURES / "fts_sample.json").read_text())["releases"]
