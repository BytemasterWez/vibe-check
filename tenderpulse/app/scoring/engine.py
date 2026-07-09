"""Deterministic, explainable relevance scoring of notices against a profile.

Every point awarded carries a human-readable reason, so buyer-facing output can
always answer "why was this matched?". No LLM in the scoring path (Phase 8C).

Weights (max 100):
  CPV code match         35
  keyword match          30  (title hits worth more than description hits)
  region match           10
  value band fit         10
  SME suitability        10
  deadline runway         5
A notice whose deadline has already passed (or is inside the profile's minimum
bid-preparation window) scores 0 — there is nothing actionable to sell.
"""
import re
from datetime import datetime

from ..models import Notice, Profile


def score_notice(notice: Notice, profile: Profile, now: datetime | None = None) -> tuple[int, list[str]]:
    now = now or datetime.utcnow()
    score = 0
    reasons: list[str] = []

    if notice.deadline_date is not None:
        days_left = (notice.deadline_date - now).days
        if days_left < 0:
            return 0, ["deadline has passed"]
        if days_left < profile.min_days_to_deadline:
            return 0, [f"only {days_left}d to deadline (profile needs {profile.min_days_to_deadline}d)"]
    else:
        days_left = None

    # CPV: prefix match so "72" catches all IT services codes.
    matched_cpv = [
        code
        for code in (notice.cpv_codes or [])
        if any(code.startswith(prefix) for prefix in (profile.cpv_prefixes or []))
    ]
    if matched_cpv:
        score += 35
        reasons.append(f"CPV match: {', '.join(matched_cpv[:3])}")
    elif profile.cpv_prefixes:
        reasons.append("no CPV match")

    title = (notice.title or "").lower()
    description = (notice.description or "").lower()
    kw_points = 0
    for kw in profile.keywords or []:
        # Word-boundary match: "IT" must not fire inside "Insulin" or "with".
        pattern = re.compile(r"\b" + re.escape(kw.lower()) + r"\b")
        if pattern.search(title):
            kw_points += 15
            reasons.append(f"keyword '{kw}' in title")
        elif pattern.search(description):
            kw_points += 8
            reasons.append(f"keyword '{kw}' in description")
    score += min(kw_points, 30)

    if profile.regions:
        notice_regions = {r.lower() for r in (notice.regions or [])}
        wanted = {r.lower() for r in profile.regions}
        hits = {nr for nr in notice_regions if any(w in nr or nr in w for w in wanted)}
        if hits:
            score += 10
            reasons.append(f"region match: {', '.join(sorted(hits)[:3])}")
        elif not notice_regions:
            score += 5
            reasons.append("region unknown (not penalised)")
    else:
        score += 10

    value = notice.value_amount if notice.value_amount is not None else notice.value_max
    if value is not None:
        lo = profile.min_value if profile.min_value is not None else 0
        hi = profile.max_value if profile.max_value is not None else float("inf")
        if lo <= value <= hi:
            score += 10
            reasons.append(f"value £{value:,.0f} within band")
        else:
            reasons.append(f"value £{value:,.0f} outside band")
    else:
        score += 5
        reasons.append("value unknown (not penalised)")

    if notice.sme_suitable:
        score += 10
        reasons.append("flagged suitable for SMEs")
    elif profile.require_sme and notice.sme_suitable is False:
        return 0, ["profile requires SME-suitable and notice is flagged not suitable"]

    if days_left is not None and days_left >= profile.min_days_to_deadline:
        score += 5
        reasons.append(f"{days_left} days to deadline")

    return min(score, 100), reasons
