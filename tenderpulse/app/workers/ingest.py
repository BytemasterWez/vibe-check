"""The ingestion pipeline: fetch → raw store → normalise → validate → upsert → score.

Safe to rerun: raw payloads are deduplicated by content hash, notices are
upserted by OCID (newest release wins), and scores are recomputed idempotently.
"""
import logging
from datetime import datetime, timedelta

from sqlalchemy import select

from ..connectors import CONNECTORS
from ..db import session
from ..models import IngestRun, Notice, Profile, QuarantinedRecord, RawRelease, Score
from ..normalisation.normalise import normalise_release, payload_hash
from ..scoring.engine import score_notice
from ..utils.http import SourceUnavailable
from ..validation.validate import validate_notice

log = logging.getLogger("tenderpulse.ingest")


def _upsert_notice(db, record: dict) -> str:
    existing = db.scalar(select(Notice).where(Notice.ocid == record["ocid"]))
    if existing is None:
        db.add(Notice(**record))
        return "inserted"
    if existing.raw_payload_hash == record["raw_payload_hash"]:
        return "unchanged"
    for key, value in record.items():
        setattr(existing, key, value)
    return "updated"


def run_source(source_name: str, since_days: int = 1, max_pages: int | None = None,
               releases_override: list[dict] | None = None) -> IngestRun:
    """Ingest one source. releases_override lets tests inject fixture data."""
    connector = CONNECTORS[source_name]()
    now = datetime.utcnow()
    since = (now - timedelta(days=since_days)).strftime("%Y-%m-%dT%H:%M:%S")
    until = now.strftime("%Y-%m-%dT%H:%M:%S")

    with session() as db:
        run = IngestRun(source_name=source_name)
        db.add(run)
        db.flush()
        run_id = run.id

    seen = inserted = updated = quarantined = 0
    error = ""
    try:
        releases = (
            releases_override
            if releases_override is not None
            else connector.fetch(since, until, max_pages)
        )
        with session() as db:
            for release in releases:
                seen += 1
                rhash = payload_hash(release)
                ocid = str(release.get("ocid") or "")

                if not db.scalar(select(RawRelease.id).where(RawRelease.payload_hash == rhash)):
                    db.add(RawRelease(
                        source_name=source_name, ocid=ocid,
                        release_id=str(release.get("id") or ""),
                        payload=release, payload_hash=rhash,
                    ))

                record = normalise_release(release, source_name, connector.notice_url(release))
                problems = validate_notice(record)
                if problems:
                    quarantined += 1
                    db.add(QuarantinedRecord(
                        source_name=source_name, ocid=ocid,
                        reason="; ".join(problems), payload=release,
                    ))
                    continue

                outcome = _upsert_notice(db, record)
                inserted += outcome == "inserted"
                updated += outcome == "updated"
        status = "ok"
    except SourceUnavailable as err:
        status, error = "source_unavailable", str(err)
        log.error("source %s unavailable: %s", source_name, err)
    except Exception as err:  # noqa: BLE001 — the run record must reflect any failure
        status, error = "failed", f"{type(err).__name__}: {err}"
        log.exception("ingest run failed for %s", source_name)

    with session() as db:
        run = db.get(IngestRun, run_id)
        run.finished_at = datetime.utcnow()
        run.status = status
        run.releases_seen = seen
        run.inserted = inserted
        run.updated = updated
        run.quarantined = quarantined
        run.error = error
    return run


def rescore_all() -> int:
    """Recompute scores for every active-deadline notice against every profile."""
    count = 0
    with session() as db:
        profiles = db.scalars(select(Profile)).all()
        notices = db.scalars(select(Notice)).all()
        for profile in profiles:
            for notice in notices:
                value, reasons = score_notice(notice, profile)
                existing = db.scalar(
                    select(Score).where(
                        Score.notice_id == notice.id, Score.profile_id == profile.id
                    )
                )
                if existing:
                    existing.score, existing.reasons = value, reasons
                else:
                    db.add(Score(notice_id=notice.id, profile_id=profile.id,
                                 score=value, reasons=reasons))
                count += 1
    return count


def run_all(since_days: int = 1, max_pages: int | None = None) -> list[IngestRun]:
    runs = [run_source(name, since_days, max_pages) for name in CONNECTORS]
    rescore_all()
    return runs


if __name__ == "__main__":
    import argparse

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
    parser = argparse.ArgumentParser(description="Run TenderPulse ingestion")
    parser.add_argument("--source", choices=list(CONNECTORS) + ["all"], default="all")
    parser.add_argument("--since-days", type=int, default=1)
    parser.add_argument("--max-pages", type=int, default=None)
    args = parser.parse_args()

    if args.source == "all":
        runs = run_all(args.since_days, args.max_pages)
    else:
        runs = [run_source(args.source, args.since_days, args.max_pages)]
        rescore_all()
    for run in runs:
        print(f"{run.source_name}: {run.status} seen={run.releases_seen} "
              f"inserted={run.inserted} updated={run.updated} quarantined={run.quarantined}"
              + (f" error={run.error}" if run.error else ""))
