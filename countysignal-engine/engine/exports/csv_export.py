"""Evidence-backed CSV exports (scorecards, rankings)."""

from __future__ import annotations

import csv
import json
from pathlib import Path

from engine.scoring.engine import CountyScore


def export_scorecard_csv(
    scores: list[CountyScore],
    path: Path,
    *,
    county_names: dict[str, str] | None = None,
) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="") as fh:
        writer = csv.writer(fh)
        writer.writerow(
            [
                "county_fips",
                "county_name",
                "period",
                "score",
                "rank_national",
                "rank_state",
                "confidence",
                "top_positive_factors",
                "top_negative_factors",
                "evidence_json",
            ]
        )
        for s in sorted(scores, key=lambda s: s.rank_national):
            writer.writerow(
                [
                    s.county_fips,
                    (county_names or {}).get(s.county_fips, ""),
                    s.period,
                    s.score,
                    s.rank_national,
                    s.rank_state,
                    s.confidence,
                    json.dumps(s.top_positive_factors),
                    json.dumps(s.top_negative_factors),
                    json.dumps(s.evidence),
                ]
            )
    return path


def rows_to_csv(rows: list[dict], path: Path) -> Path:
    """Generic dict-rows CSV writer used by API CSV export."""
    path.parent.mkdir(parents=True, exist_ok=True)
    if not rows:
        path.write_text("")
        return path
    with path.open("w", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        for r in rows:
            writer.writerow({k: (json.dumps(v) if isinstance(v, (dict, list)) else v) for k, v in r.items()})
    return path
