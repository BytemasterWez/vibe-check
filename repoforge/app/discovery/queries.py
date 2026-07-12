"""Seed discovery queries and date-window splitting.

Broad capability families are split into created/updated/star windows so the
GitHub 1000-result search cap does not silently hide repositories.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta

SEED_CAPABILITY_FAMILIES: list[str] = [
    "document parsing",
    "OCR",
    "knowledge graphs",
    "computer vision",
    "speech recognition",
    "audio processing",
    "workflow automation",
    "local-first AI",
    "privacy-preserving AI",
    "anomaly detection",
    "forecasting",
    "optimisation",
    "geospatial processing",
    "industrial protocols",
    "telemetry",
    "observability",
    "compliance",
    "audit",
    "security",
    "healthcare administration",
    "dental software",
    "legal technology",
    "insurance processing",
    "energy systems",
    "smart metering",
    "sensor fusion",
    "digital twins",
    "browser automation",
    "desktop automation",
    "report generation",
    "API gateways",
    "data validation",
    "entity resolution",
    "database interfaces",
    "edge computing",
    "offline applications",
]


@dataclass(frozen=True)
class DateWindow:
    start: date
    end: date

    def as_created_qualifier(self) -> str:
        return f"created:{self.start.isoformat()}..{self.end.isoformat()}"

    def as_pushed_qualifier(self) -> str:
        return f"pushed:{self.start.isoformat()}..{self.end.isoformat()}"


def month_windows(start: date, end: date) -> list[DateWindow]:
    """Split a range into ~monthly windows to stay under the 1000-result cap."""
    windows: list[DateWindow] = []
    cur = start
    while cur < end:
        # advance ~30 days
        nxt = min(cur + timedelta(days=30), end)
        windows.append(DateWindow(cur, nxt))
        cur = nxt + timedelta(days=1)
    return windows


def build_query(
    term: str,
    window: DateWindow | None = None,
    *,
    min_stars: int = 5,
    window_field: str = "created",
) -> str:
    """Compose a GitHub search query string for a term and optional date window."""
    parts = [f'"{term}"' if " " in term else term, f"stars:>={min_stars}"]
    if window is not None:
        parts.append(
            window.as_created_qualifier()
            if window_field == "created"
            else window.as_pushed_qualifier()
        )
    return " ".join(parts)
