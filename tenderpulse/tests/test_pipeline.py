"""End-to-end pipeline tests on real fixture data with a throwaway database."""
from sqlalchemy import select

from app.db import session
from app.models import IngestRun, Notice, Profile, QuarantinedRecord, RawRelease, Score
from app.workers.ingest import rescore_all, run_source


def ingest_fixtures(cf_releases):
    return run_source("contracts_finder", releases_override=cf_releases)


def test_ingest_stores_raw_and_normalised(fresh_db, cf_releases):
    run = ingest_fixtures(cf_releases)
    assert run.status == "ok"
    assert run.releases_seen == 3
    assert run.inserted == 3
    assert run.quarantined == 0
    with session() as db:
        assert db.scalar(select(RawRelease).limit(1)) is not None
        notices = db.scalars(select(Notice)).all()
        assert len(notices) == 3
        assert all(n.ocid.startswith("ocds-") for n in notices)


def test_rerun_is_idempotent_no_duplicates(fresh_db, cf_releases):
    ingest_fixtures(cf_releases)
    run2 = ingest_fixtures(cf_releases)
    assert run2.inserted == 0
    assert run2.updated == 0  # identical payload hash -> unchanged
    with session() as db:
        assert len(db.scalars(select(Notice)).all()) == 3
        assert len(db.scalars(select(RawRelease)).all()) == 3


def test_changed_release_updates_notice(fresh_db, cf_releases):
    ingest_fixtures(cf_releases)
    modified = [dict(cf_releases[0])]
    modified[0]["tender"] = dict(modified[0]["tender"], title="UPDATED TITLE")
    run = run_source("contracts_finder", releases_override=modified)
    assert run.updated == 1
    with session() as db:
        notice = db.scalar(select(Notice).where(Notice.ocid == modified[0]["ocid"]))
        assert notice.title == "UPDATED TITLE"


def test_bad_release_is_quarantined_not_dropped(fresh_db, cf_releases):
    bad = {"ocid": "", "id": "broken", "tender": {}}
    run = run_source("contracts_finder", releases_override=[*cf_releases, bad])
    assert run.quarantined == 1
    assert run.inserted == 3
    with session() as db:
        q = db.scalars(select(QuarantinedRecord)).all()
        assert len(q) == 1
        assert "missing required field" in q[0].reason


def test_source_failure_recorded_in_run(fresh_db, monkeypatch):
    from app.utils.http import SourceUnavailable

    def boom(*a, **k):
        raise SourceUnavailable("simulated outage")

    monkeypatch.setattr("app.connectors.base.get_json", boom)
    run = run_source("contracts_finder", max_pages=1)
    assert run.status == "source_unavailable"
    assert "simulated outage" in run.error
    with session() as db:
        stored = db.get(IngestRun, run.id)
        assert stored.finished_at is not None


def test_scoring_end_to_end(fresh_db, cf_releases, fts_releases):
    run_source("contracts_finder", releases_override=cf_releases)
    run_source("find_a_tender", releases_override=fts_releases)
    with session() as db:
        db.add(Profile(name="everything", keywords=[], cpv_prefixes=[],
                       regions=[], min_days_to_deadline=0))
    count = rescore_all()
    assert count == 6
    with session() as db:
        scores = db.scalars(select(Score)).all()
        assert len(scores) == 6
        assert all(isinstance(s.reasons, list) for s in scores)


def test_rescore_is_idempotent(fresh_db, cf_releases):
    run_source("contracts_finder", releases_override=cf_releases)
    with session() as db:
        db.add(Profile(name="p", keywords=["filming"], cpv_prefixes=["79"],
                       min_days_to_deadline=0))
    rescore_all()
    rescore_all()
    with session() as db:
        assert len(db.scalars(select(Score)).all()) == 3
