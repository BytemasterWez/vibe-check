"""Digest and export generation: the buyer-facing output of the system.

Markdown digest per profile (top matches with evidence), CSV export of matches.
The optional LLM summary is additive — the digest is complete without it.
"""
import csv
import io
from datetime import datetime

from sqlalchemy import select

from .. import config
from ..db import session
from ..models import Notice, Profile, Score


def top_matches(profile_id: int, min_score: int = 40, limit: int = 25) -> list[tuple]:
    with session() as db:
        rows = db.execute(
            select(Score, Notice)
            .join(Notice, Score.notice_id == Notice.id)
            .where(Score.profile_id == profile_id, Score.score >= min_score)
            .order_by(Score.score.desc(), Notice.deadline_date.asc())
            .limit(limit)
        ).all()
    return rows


def digest_markdown(profile_id: int, min_score: int = 40, limit: int = 25) -> str:
    with session() as db:
        profile = db.get(Profile, profile_id)
        if profile is None:
            raise ValueError(f"no such profile: {profile_id}")
        profile_name = profile.name
    rows = top_matches(profile_id, min_score, limit)

    lines = [
        f"# TenderPulse digest — {profile_name}",
        f"Generated {datetime.utcnow().strftime('%Y-%m-%d %H:%M')} UTC · "
        f"{len(rows)} matches scoring ≥{min_score}",
        "",
    ]
    if not rows:
        lines.append("No matching open tenders in this run.")
    for score, notice in rows:
        deadline = notice.deadline_date.strftime("%Y-%m-%d") if notice.deadline_date else "n/a"
        value = f"£{notice.value_amount:,.0f}" if notice.value_amount else "value n/a"
        lines += [
            f"## [{score.score}] {notice.title}",
            f"- **Buyer:** {notice.buyer_name or 'unknown'}",
            f"- **Deadline:** {deadline} · **Value:** {value} · **Source:** {notice.source_name}",
            f"- **Why matched:** {'; '.join(score.reasons)}",
            f"- **Evidence:** {notice.source_url or notice.ocid}",
            "",
        ]

    summary = _optional_llm_summary(lines)
    if summary:
        lines.insert(3, f"> **Summary:** {summary}\n")
    return "\n".join(lines)


def _optional_llm_summary(digest_lines: list[str]) -> str | None:
    if not config.LLM_API_KEY:
        return None
    try:
        from ..utils.llm import summarise
        return summarise("\n".join(digest_lines[:80]))
    except Exception:
        return None  # digest must always work without the model (Phase 8C)


def matches_csv(profile_id: int, min_score: int = 40, limit: int = 200) -> str:
    rows = top_matches(profile_id, min_score, limit)
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow([
        "score", "title", "buyer", "deadline", "value_amount", "currency",
        "cpv_codes", "regions", "sme_suitable", "source", "url", "ocid", "reasons",
    ])
    for score, notice in rows:
        writer.writerow([
            score.score, notice.title, notice.buyer_name,
            notice.deadline_date.isoformat() if notice.deadline_date else "",
            notice.value_amount or "", notice.value_currency,
            "|".join(notice.cpv_codes or []), "|".join(notice.regions or []),
            notice.sme_suitable, notice.source_name, notice.source_url,
            notice.ocid, "; ".join(score.reasons),
        ])
    return buf.getvalue()


def write_digest_file(profile_id: int) -> str:
    config.ensure_dirs()
    content = digest_markdown(profile_id)
    path = config.REPORT_DIR / f"digest_profile{profile_id}_{datetime.utcnow():%Y%m%d}.md"
    path.write_text(content)
    return str(path)
