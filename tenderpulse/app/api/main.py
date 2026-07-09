"""FastAPI backend: health/status, notices, matches, exports, mini dashboard."""
import html
from datetime import datetime

from fastapi import FastAPI, HTTPException
from fastapi.responses import HTMLResponse, PlainTextResponse
from sqlalchemy import func, select

from ..db import session
from ..models import IngestRun, Notice, Profile, QuarantinedRecord, Score
from ..reports.digest import digest_markdown, matches_csv

app = FastAPI(title="TenderPulse", version="0.1.0")


@app.get("/health")
def health() -> dict:
    with session() as db:
        last_runs = {}
        for source in db.scalars(select(IngestRun.source_name).distinct()):
            run = db.scalar(
                select(IngestRun)
                .where(IngestRun.source_name == source)
                .order_by(IngestRun.started_at.desc())
                .limit(1)
            )
            last_runs[source] = {
                "status": run.status,
                "finished_at": run.finished_at.isoformat() if run.finished_at else None,
                "releases_seen": run.releases_seen,
                "quarantined": run.quarantined,
            }
        return {
            "status": "ok",
            "notices": db.scalar(select(func.count(Notice.id))),
            "quarantined": db.scalar(select(func.count(QuarantinedRecord.id))),
            "last_runs": last_runs,
        }


@app.get("/notices")
def list_notices(limit: int = 50, source: str | None = None) -> list[dict]:
    with session() as db:
        query = select(Notice).order_by(Notice.published_date.desc()).limit(min(limit, 500))
        if source:
            query = query.where(Notice.source_name == source)
        return [
            {
                "ocid": n.ocid,
                "title": n.title,
                "buyer": n.buyer_name,
                "deadline": n.deadline_date.isoformat() if n.deadline_date else None,
                "value": n.value_amount,
                "cpv": n.cpv_codes,
                "regions": n.regions,
                "sme": n.sme_suitable,
                "source": n.source_name,
                "url": n.source_url,
            }
            for n in db.scalars(query)
        ]


@app.get("/profiles")
def list_profiles() -> list[dict]:
    with session() as db:
        return [
            {"id": p.id, "name": p.name, "keywords": p.keywords, "cpv_prefixes": p.cpv_prefixes}
            for p in db.scalars(select(Profile))
        ]


@app.post("/profiles")
def create_profile(body: dict) -> dict:
    if not body.get("name"):
        raise HTTPException(422, "profile needs a name")
    with session() as db:
        profile = Profile(
            name=body["name"],
            keywords=body.get("keywords", []),
            cpv_prefixes=body.get("cpv_prefixes", []),
            regions=body.get("regions", []),
            min_value=body.get("min_value"),
            max_value=body.get("max_value"),
            require_sme=bool(body.get("require_sme", False)),
            min_days_to_deadline=int(body.get("min_days_to_deadline", 5)),
        )
        db.add(profile)
        db.flush()
        return {"id": profile.id, "name": profile.name}


@app.get("/matches/{profile_id}", response_class=PlainTextResponse)
def matches_digest(profile_id: int, min_score: int = 40) -> str:
    try:
        return digest_markdown(profile_id, min_score=min_score)
    except ValueError as err:
        raise HTTPException(404, str(err)) from err


@app.get("/matches/{profile_id}/export.csv")
def matches_export(profile_id: int, min_score: int = 40) -> PlainTextResponse:
    return PlainTextResponse(
        matches_csv(profile_id, min_score=min_score),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=matches_p{profile_id}.csv"},
    )


@app.get("/", response_class=HTMLResponse)
def dashboard() -> str:
    with session() as db:
        notice_count = db.scalar(select(func.count(Notice.id)))
        quarantine_count = db.scalar(select(func.count(QuarantinedRecord.id)))
        runs = db.scalars(
            select(IngestRun).order_by(IngestRun.started_at.desc()).limit(10)
        ).all()
        top = db.execute(
            select(Score, Notice)
            .join(Notice, Score.notice_id == Notice.id)
            .where(Score.score >= 40)
            .order_by(Score.score.desc())
            .limit(20)
        ).all()

    def esc(x) -> str:
        return html.escape(str(x if x is not None else ""))

    run_rows = "".join(
        f"<tr><td>{esc(r.source_name)}</td><td>{esc(r.status)}</td>"
        f"<td>{esc(r.finished_at and r.finished_at.strftime('%Y-%m-%d %H:%M'))}</td>"
        f"<td>{r.releases_seen}</td><td>{r.inserted}</td><td>{r.updated}</td>"
        f"<td>{r.quarantined}</td></tr>"
        for r in runs
    )
    match_rows = "".join(
        f"<tr><td>{s.score}</td><td><a href='{esc(n.source_url)}'>{esc(n.title)}</a></td>"
        f"<td>{esc(n.buyer_name)}</td>"
        f"<td>{esc(n.deadline_date and n.deadline_date.strftime('%Y-%m-%d'))}</td>"
        f"<td>{esc('; '.join(s.reasons))}</td></tr>"
        for s, n in top
    )
    return f"""<!doctype html><meta charset="utf-8"><title>TenderPulse</title>
<style>body{{font-family:system-ui;margin:2rem;max-width:70rem}}table{{border-collapse:collapse;width:100%;margin:1rem 0}}
td,th{{border:1px solid #ccc;padding:.4rem .6rem;text-align:left;font-size:.9rem}}h1{{margin-bottom:0}}</style>
<h1>TenderPulse</h1>
<p>{notice_count} notices · {quarantine_count} quarantined · generated {datetime.utcnow():%Y-%m-%d %H:%M} UTC</p>
<h2>Recent ingestion runs</h2>
<table><tr><th>Source</th><th>Status</th><th>Finished</th><th>Seen</th><th>Inserted</th><th>Updated</th><th>Quarantined</th></tr>{run_rows}</table>
<h2>Top matches (all profiles, score ≥ 40)</h2>
<table><tr><th>Score</th><th>Title</th><th>Buyer</th><th>Deadline</th><th>Why</th></tr>{match_rows}</table>"""
