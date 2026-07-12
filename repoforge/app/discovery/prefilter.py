"""Cheap deterministic pre-filtering, run before any LLM call.

Returns a verdict (ACCEPT / QUARANTINE / REJECT) plus the evidence explaining
it. Evidence is never discarded — a rejected repo can be reconsidered later.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime
from enum import Enum

from app.licensing.policy import classify
from app.models.schemas import LicenceClass


class Verdict(str, Enum):
    ACCEPT = "accept"
    QUARANTINE = "quarantine"
    REJECT = "reject"


@dataclass
class FilterResult:
    verdict: Verdict
    reasons: list[str] = field(default_factory=list)
    signals: dict[str, object] = field(default_factory=dict)


_CRYPTO_SPAM_MARKERS = (
    "airdrop",
    "free tokens",
    "pump",
    "1000x",
    "presale",
    "shitcoin",
)


def _age_days(iso: str | None) -> int | None:
    if not iso:
        return None
    try:
        dt = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    except ValueError:
        return None
    return (datetime.now(UTC) - dt).days


def prefilter(repo: dict) -> FilterResult:
    """Apply cheap heuristics to a GitHub repo API payload."""
    reasons: list[str] = []
    signals: dict[str, object] = {}

    stars = int(repo.get("stargazers_count", 0) or 0)
    forks = int(repo.get("forks_count", 0) or 0)
    size_kb = int(repo.get("size", 0) or 0)
    archived = bool(repo.get("archived", False))
    is_fork = bool(repo.get("fork", False))
    description = (repo.get("description") or "").lower()
    pushed_at = repo.get("pushed_at")
    open_issues = int(repo.get("open_issues_count", 0) or 0)
    days_since_push = _age_days(pushed_at)
    signals["open_issues"] = open_issues

    lic = repo.get("license") or {}
    spdx = lic.get("spdx_id") if isinstance(lic, dict) else None
    licence = classify(spdx)

    signals.update(
        stars=stars,
        forks=forks,
        size_kb=size_kb,
        archived=archived,
        is_fork=is_fork,
        days_since_push=days_since_push,
        licence_class=licence.licence_class.value,
    )

    # --- Hard rejects ---
    if size_kb == 0:
        reasons.append("empty repository (size 0)")
        return FilterResult(Verdict.REJECT, reasons, signals)

    if any(marker in description for marker in _CRYPTO_SPAM_MARKERS):
        reasons.append("crypto-spam markers in description")
        return FilterResult(Verdict.REJECT, reasons, signals)

    if licence.licence_class == LicenceClass.non_commercial:
        reasons.append("non-commercial licence — commercially incompatible")
        return FilterResult(Verdict.REJECT, reasons, signals)

    # --- Quarantine (reconsider later, don't discard) ---
    if archived:
        reasons.append("archived; needs credible maintained fork before use")
        return FilterResult(Verdict.QUARANTINE, reasons, signals)

    if licence.licence_class in (LicenceClass.unknown, LicenceClass.conflicting):
        reasons.append("licence unknown/ambiguous — cannot assume commercial safety")
        return FilterResult(Verdict.QUARANTINE, reasons, signals)

    if stars < 5 and forks < 2:
        reasons.append("very low adoption signal")
        return FilterResult(Verdict.QUARANTINE, reasons, signals)

    if days_since_push is not None and days_since_push > 365 * 2:
        reasons.append("no meaningful commit in >2 years")
        return FilterResult(Verdict.QUARANTINE, reasons, signals)

    if is_fork and stars < 20:
        reasons.append("fork without differentiated adoption")
        return FilterResult(Verdict.QUARANTINE, reasons, signals)

    if any(w in description for w in ("tutorial", "example", "boilerplate", "starter kit")):
        reasons.append("appears to be a tutorial/example")
        return FilterResult(Verdict.QUARANTINE, reasons, signals)

    reasons.append("passes cheap pre-filter")
    return FilterResult(Verdict.ACCEPT, reasons, signals)
