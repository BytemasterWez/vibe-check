"""FEMA National Risk Index — county table (static/slow-moving).

Access method: official bulk download (zip containing a county CSV) per
contracts/sources/fema_nri.yaml. Sample mode reads the bundled fixture CSV.
"""

from __future__ import annotations

import csv
import io
import re
import zipfile
from datetime import date, datetime
from typing import Any

from adapters.base import ParsedBatch, RawArtifact, RunContext, SourceAdapter
from engine.normalisation.normalise import ParsedRecord
from engine.provenance import row_hash

_FIELDS = ["NRI_ID", "STCOFIPS", "STATE", "COUNTY", "NRI_VER", "RISK_SCORE",
           "RISK_RATNG", "EAL_SCORE", "SOVI_SCORE", "RESL_SCORE", "POPULATION"]


class FemaNriAdapter(SourceAdapter):
    source_id = "fema_nri"

    def fetch(self, run_context: RunContext) -> RawArtifact:
        if run_context.mode == "sample":
            return self._fixture_artifact(run_context, content_type="text/csv")
        url = self.contract.download_url
        resp = self._http_get(url, timeout=600.0)
        return RawArtifact(
            filename=url.rsplit("/", 1)[-1],
            data=resp.content,
            source_url=url,
            content_type=resp.headers.get("content-type", "application/zip"),
        )

    def parse(self, raw_artifact: RawArtifact) -> ParsedBatch:
        if raw_artifact.filename.endswith(".zip"):
            with zipfile.ZipFile(io.BytesIO(raw_artifact.data)) as zf:
                csv_names = [n for n in zf.namelist() if n.lower().endswith(".csv")]
                text = zf.read(csv_names[0]).decode("utf-8-sig", errors="replace")
        else:
            text = raw_artifact.data.decode("utf-8-sig", errors="replace")

        records: list[ParsedRecord] = []
        observed_fields: set[str] = set()
        field_map = self.contract.field_map
        for row in csv.DictReader(io.StringIO(text)):
            slim = {k: row.get(k) for k in _FIELDS if k in row}
            # as_of is the NRI data vintage (e.g. "March 2023"), NOT the
            # retrieval date — otherwise static scores would look like they
            # come from the future relative to the time series they join.
            as_of = _vintage_date(slim.get("NRI_VER")) or raw_artifact.retrieved_at.date()
            # report observed fields in the contract's mapped vocabulary so
            # schema checks and drift detection compare like with like
            observed_fields.update(field_map.get(k, k) for k in slim)
            stcofips = str(slim.get("STCOFIPS", "")).split(".")[0].zfill(5)
            records.append(
                ParsedRecord(
                    source_record_id=f"{stcofips}:{slim.get('NRI_VER', 'unknown')}",
                    source_row_hash=row_hash(slim),
                    period_start=as_of,
                    period_end=as_of,
                    values={
                        "risk_score": slim.get("RISK_SCORE"),
                        "eal_score": slim.get("EAL_SCORE"),
                        "social_vuln_score": slim.get("SOVI_SCORE"),
                        "community_resilience_score": slim.get("RESL_SCORE"),
                    },
                    geography={
                        "county_fips": stcofips,
                        "state": slim.get("STATE"),
                        "county_name": slim.get("COUNTY"),
                    },
                    raw=slim,
                )
            )
        return ParsedBatch(records, sorted(observed_fields))

    def src_row(self, record: ParsedRecord) -> dict[str, Any]:
        raw = record.raw
        return {
            "nri_id": raw.get("NRI_ID"),
            "stcofips": str(raw.get("STCOFIPS", "")).split(".")[0].zfill(5),
            "state_name": raw.get("STATE"),
            "county_name": raw.get("COUNTY"),
            "nri_version": raw.get("NRI_VER"),
            "risk_score": _num(raw.get("RISK_SCORE")),
            "risk_rating": raw.get("RISK_RATNG"),
            "eal_score": _num(raw.get("EAL_SCORE")),
            "social_vuln_score": _num(raw.get("SOVI_SCORE")),
            "community_resilience_score": _num(raw.get("RESL_SCORE")),
            "population": _num(raw.get("POPULATION")),
        }


def _vintage_date(version: str | None) -> date | None:
    if not version:
        return None
    m = re.search(r"([A-Za-z]+)\s+(\d{4})", version)
    if not m:
        return None
    try:
        return datetime.strptime(f"{m.group(1)} {m.group(2)}", "%B %Y").date()
    except ValueError:
        return None


def _num(v):
    if v in (None, "", "-"):
        return None
    try:
        return float(str(v).replace(",", ""))
    except ValueError:
        return None
