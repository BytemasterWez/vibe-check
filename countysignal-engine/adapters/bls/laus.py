"""BLS Local Area Unemployment Statistics (county, monthly).

Access method: official public download (laucntycur14 — the rolling
14-month county file) per contracts/sources/bls_laus.yaml. No scraping.
Sample mode reads the bundled fixture instead of the network.
"""

from __future__ import annotations

import calendar
import csv
import io
import re
from datetime import date
from typing import Any

from adapters.base import ParsedBatch, RawArtifact, RunContext, SourceAdapter
from engine.normalisation.normalise import ParsedRecord
from engine.provenance import row_hash

_MONTH_RE = re.compile(r"^(\w{3})-(\d{2,4})")   # e.g. 'Jun-25' / 'Jun-2025(p)'
_MONTHS = {m: i for i, m in enumerate(calendar.month_abbr) if m}


def _parse_period(year: Any, month: Any) -> tuple[date | None, date | None]:
    try:
        y, m = int(year), int(month)
        last = calendar.monthrange(y, m)[1]
        return date(y, m, 1), date(y, m, last)
    except (TypeError, ValueError):
        return None, None


class BlsLausAdapter(SourceAdapter):
    source_id = "bls_laus"

    def fetch(self, run_context: RunContext) -> RawArtifact:
        if run_context.mode == "sample":
            return self._fixture_artifact(run_context, content_type="text/csv")
        url = self.contract.download_url
        resp = self._http_get(url)
        return RawArtifact(
            filename=url.rsplit("/", 1)[-1],
            data=resp.content,
            source_url=url,
            content_type=resp.headers.get("content-type", "text/plain"),
        )

    def parse(self, raw_artifact: RawArtifact) -> ParsedBatch:
        text = raw_artifact.data.decode("utf-8", errors="replace")
        if raw_artifact.filename.endswith(".csv"):
            rows = self._parse_csv(text)
        else:
            rows = self._parse_bls_fixed(text)

        records: list[ParsedRecord] = []
        observed_fields: set[str] = set()
        for row in rows:
            observed_fields.update(row.keys())
            period_start, period_end = _parse_period(row.get("period_year"),
                                                     row.get("period_month"))
            area_fips = (str(row.get("state_fips", "")).zfill(2)
                         + str(row.get("county_fips_part", "")).zfill(3))
            source_record_id = f"{area_fips}:{row.get('period_year')}-{row.get('period_month')}"
            records.append(
                ParsedRecord(
                    source_record_id=source_record_id,
                    source_row_hash=row_hash(row),
                    period_start=period_start,
                    period_end=period_end,
                    values={
                        "unemployment_rate": row.get("unemployment_rate"),
                        "labor_force": row.get("labor_force"),
                        "employed": row.get("employed"),
                        "unemployed": row.get("unemployed"),
                    },
                    geography={
                        "state_fips": row.get("state_fips"),
                        "county_fips_part": row.get("county_fips_part"),
                        "county_name": _strip_state(row.get("area_title", "")),
                        "state": row.get("state_fips"),
                    },
                    raw=row,
                )
            )
        return ParsedBatch(records, sorted(observed_fields))

    def _parse_csv(self, text: str) -> list[dict]:
        """Fixture/normalised CSV layout: laus_code,state_fips,county_fips,
        area_title,year,month,labor_force,employed,unemployed,unemployment_rate."""
        out = []
        for row in csv.DictReader(io.StringIO(text)):
            out.append(
                {
                    "series_id": row.get("laus_code", ""),
                    "state_fips": row.get("state_fips", ""),
                    "county_fips_part": row.get("county_fips", ""),
                    "area_title": row.get("area_title", ""),
                    "period_year": row.get("year"),
                    "period_month": row.get("month"),
                    "labor_force": row.get("labor_force"),
                    "employed": row.get("employed"),
                    "unemployed": row.get("unemployed"),
                    "unemployment_rate": row.get("unemployment_rate"),
                }
            )
        return out

    def _parse_bls_fixed(self, text: str) -> list[dict]:
        """The official laucntycur14.txt: pipe-delimited with header banner."""
        out = []
        for line in text.splitlines():
            parts = [p.strip() for p in line.split("|")]
            if len(parts) < 9 or not parts[1].isdigit():
                continue
            m = _MONTH_RE.match(parts[4])
            if not m:
                continue
            month = _MONTHS.get(m.group(1))
            year = int(m.group(2))
            if year < 100:
                year += 2000
            out.append(
                {
                    "series_id": parts[0],
                    "state_fips": parts[1],
                    "county_fips_part": parts[2],
                    "area_title": parts[3],
                    "period_year": year,
                    "period_month": month,
                    "labor_force": parts[5].replace(",", ""),
                    "employed": parts[6].replace(",", ""),
                    "unemployed": parts[7].replace(",", ""),
                    "unemployment_rate": parts[8],
                }
            )
        return out

    def src_row(self, record: ParsedRecord) -> dict[str, Any]:
        raw = record.raw
        area_fips = (str(raw.get("state_fips", "")).zfill(2)
                     + str(raw.get("county_fips_part", "")).zfill(3))
        return {
            "series_id": raw.get("series_id"),
            "area_code": raw.get("series_id"),
            "area_fips": area_fips,
            "area_title": raw.get("area_title"),
            "period_year": int(raw["period_year"]) if raw.get("period_year") else None,
            "period_month": int(raw["period_month"]) if raw.get("period_month") else None,
            "labor_force": _num(raw.get("labor_force")),
            "employed": _num(raw.get("employed")),
            "unemployed": _num(raw.get("unemployed")),
            "unemployment_rate": _num(raw.get("unemployment_rate")),
        }


def _strip_state(area_title: str) -> str:
    """'St. Tammany Parish, LA' -> 'St. Tammany Parish'."""
    return area_title.rsplit(",", 1)[0].strip()


def _num(v):
    if v in (None, "", "-", "N.A."):
        return None
    try:
        return float(str(v).replace(",", ""))
    except ValueError:
        return None
