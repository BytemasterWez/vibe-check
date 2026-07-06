"""Census ACS 5-year estimates (county, annual) via the official Census API.

The API returns a JSON array-of-arrays with a header row; the first columns
are the requested variables, the trailing columns are geography codes.
An API key (CENSUS_API_KEY) is optional and only raises rate limits.
Sample mode reads the bundled fixture.
"""

from __future__ import annotations

import json
from datetime import date
from typing import Any

from adapters.base import ParsedBatch, RawArtifact, RunContext, SourceAdapter
from engine.normalisation.normalise import ParsedRecord
from engine.provenance import row_hash


class CensusAcsAdapter(SourceAdapter):
    source_id = "census_acs"

    def sample_fixture(self, run_context: RunContext):
        return run_context.fixtures_dir / "census_acs_sample.json"

    def fetch(self, run_context: RunContext) -> RawArtifact:
        year = int(run_context.params.get("year", date.today().year - 2))
        if run_context.mode == "sample":
            artifact = self._fixture_artifact(run_context, content_type="application/json")
            artifact.request_params["year"] = json.loads(artifact.data.decode())["year"]
            return artifact

        get_vars = self.contract.api_params["get_variables"]
        url = self.contract.download_url.format(year=year)
        params = {"get": "NAME," + ",".join(get_vars),
                  "for": self.contract.api_params.get("for", "county:*")}
        if run_context.settings.census_api_key:
            params["key"] = run_context.settings.census_api_key
        resp = self._http_get(url, params={k: v for k, v in params.items()})
        # Wrap so the artifact self-describes its vintage even at rest.
        payload = json.dumps({"year": year, "data": resp.json()}).encode()
        return RawArtifact(
            filename=f"acs5_{year}_county.json",
            data=payload,
            source_url=str(resp.url),
            request_params={"year": year, "get": params["get"], "for": params["for"]},
            content_type="application/json",
        )

    def parse(self, raw_artifact: RawArtifact) -> ParsedBatch:
        wrapper = json.loads(raw_artifact.data.decode())
        year = int(wrapper["year"])
        table = wrapper["data"]
        header, rows = table[0], table[1:]
        records: list[ParsedRecord] = []
        for values in rows:
            row = dict(zip(header, values))
            state = row.get("state", "")
            county = row.get("county", "")
            geoid = f"{state}{county}"
            variable_values = {
                k: row.get(k) for k in header if k not in ("NAME", "state", "county")
            }
            records.append(
                ParsedRecord(
                    source_record_id=f"{geoid}:{year}",
                    source_row_hash=row_hash(row),
                    period_start=date(year, 1, 1),
                    period_end=date(year, 12, 31),
                    values=variable_values,
                    geography={
                        "state_fips": state,
                        "county_fips_part": county,
                        "geoid": geoid,
                        "county_name": row.get("NAME", "").split(",")[0],
                        "state": state,
                    },
                    raw={**row, "acs_year": year},
                )
            )
        observed = [h for h in header if h != "NAME"] + ["acs_year"]
        return ParsedBatch(records, sorted(observed))

    # src.census_acs is long (one row per county-year-variable), so each row
    # gets its own source_record_id.
    def src_rows(self, record: ParsedRecord) -> list[dict[str, Any]]:
        raw = record.raw
        out = []
        for var_code, value in record.values.items():
            out.append(
                {
                    "geo_id": f"0500000US{raw.get('state','')}{raw.get('county','')}",
                    "state_code": raw.get("state"),
                    "county_code": raw.get("county"),
                    "name": raw.get("NAME"),
                    "acs_year": raw.get("acs_year"),
                    "variable_code": var_code,
                    "estimate": _num(value),
                    "margin_of_error": None,
                    "source_record_id": f"{record.source_record_id}:{var_code}",
                }
            )
        return out


def _num(v):
    if v in (None, "", "-", "null"):
        return None
    try:
        f = float(str(v).replace(",", ""))
    except ValueError:
        return None
    # Census uses large negative sentinels for suppressed values.
    return None if f <= -666_666_666 else f
