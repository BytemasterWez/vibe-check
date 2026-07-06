"""CountySignal Engine API.

Every data endpoint reads from stable api.* views through a read-only role.
Raw internal tables (src.*, norm.*, …) are never exposed. All /v1 routes
require an API key; /health and /version are open.
"""

from __future__ import annotations

import csv
import io
import time

from fastapi import Depends, FastAPI, HTTPException, Query, Request, Response
from fastapi.responses import JSONResponse

from engine import __version__
from services.api.deps import (
    log_usage,
    new_request_id,
    pagination,
    query_rows,
    require_api_key,
    structured_error,
)

app = FastAPI(
    title="CountySignal Engine API",
    version=__version__,
    description="Product-agnostic national county signal substrate. "
                "All endpoints serve normalised, provenance-backed county data.",
)


@app.middleware("http")
async def request_context(request: Request, call_next):
    request.state.request_id = new_request_id()
    start = time.monotonic()
    try:
        response = await call_next(request)
    except Exception:
        log_usage(request, 500, (time.monotonic() - start) * 1000)
        raise
    response.headers["X-Request-ID"] = request.state.request_id
    log_usage(request, response.status_code, (time.monotonic() - start) * 1000)
    return response


@app.exception_handler(HTTPException)
async def http_exc_handler(request: Request, exc: HTTPException):
    detail = exc.detail if isinstance(exc.detail, dict) else structured_error(
        request, "error", str(exc.detail))
    return JSONResponse(status_code=exc.status_code, content=detail)


def _csv_response(rows: list[dict], filename: str) -> Response:
    buf = io.StringIO()
    if rows:
        writer = csv.DictWriter(buf, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)
    return Response(
        content=buf.getvalue(), media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def _jsonable(rows: list[dict]) -> list[dict]:
    out = []
    for r in rows:
        out.append({k: (str(v) if hasattr(v, "isoformat") or type(v).__name__ == "Decimal"
                        else v) for k, v in r.items()})
    return out


# --- open endpoints ----------------------------------------------------------

@app.get("/health")
def health():
    try:
        query_rows("SELECT 1 AS ok")
        return {"status": "READY", "database": "ok"}
    except Exception as exc:  # noqa: BLE001
        return JSONResponse(status_code=503,
                            content={"status": "DEGRADED", "database": str(exc)})


@app.get("/version")
def version():
    return {"name": "countysignal-engine", "version": __version__, "api_version": "v1"}


# --- sources -----------------------------------------------------------------

@app.get("/v1/sources", dependencies=[Depends(require_api_key)])
def list_sources(page: dict = Depends(pagination)):
    rows = query_rows(
        """SELECT source_id, name, category, lifecycle_status
           FROM api.source_health ORDER BY source_id LIMIT :limit OFFSET :offset""",
        **page)
    return {"sources": _jsonable(rows), **page}


@app.get("/v1/source-health", dependencies=[Depends(require_api_key)])
def source_health():
    return {"sources": _jsonable(query_rows(
        "SELECT * FROM api.source_health ORDER BY source_id"))}


# --- counties ----------------------------------------------------------------

@app.get("/v1/counties", dependencies=[Depends(require_api_key)])
def list_counties(state: str | None = Query(None, min_length=2, max_length=2),
                  page: dict = Depends(pagination)):
    sql = "SELECT * FROM api.county_profile WHERE is_active"
    if state:
        sql += " AND (state_abbr = upper(:state) OR state_fips = :state)"
    sql += " ORDER BY county_fips LIMIT :limit OFFSET :offset"
    return {"counties": _jsonable(query_rows(sql, state=state, **page)), **page}


def _county_or_404(request: Request, county_fips: str) -> dict:
    rows = query_rows("SELECT * FROM api.county_profile WHERE county_fips = :f",
                      f=county_fips)
    if not rows:
        raise HTTPException(404, detail=structured_error(
            request, "county_not_found", f"no county with FIPS {county_fips}"))
    return rows[0]


@app.get("/v1/counties/{county_fips}", dependencies=[Depends(require_api_key)])
def get_county(county_fips: str, request: Request):
    return _jsonable([_county_or_404(request, county_fips)])[0]


@app.get("/v1/counties/{county_fips}/profile", dependencies=[Depends(require_api_key)])
def county_profile(county_fips: str, request: Request):
    county = _county_or_404(request, county_fips)
    signals = query_rows(
        "SELECT * FROM api.county_signal_pack WHERE county_fips = :f ORDER BY variable_id",
        f=county_fips)
    scores = query_rows(
        """SELECT recipe_id, period, score, rank_national, rank_state, confidence
           FROM api.county_scores WHERE county_fips = :f
           ORDER BY period DESC LIMIT 20""", f=county_fips)
    return {"county": _jsonable([county])[0],
            "signals": _jsonable(signals),
            "recent_scores": _jsonable(scores)}


@app.get("/v1/counties/{county_fips}/variables", dependencies=[Depends(require_api_key)])
def county_variables(county_fips: str, request: Request,
                     format: str = Query("json", pattern="^(json|csv)$")):
    _county_or_404(request, county_fips)
    rows = query_rows(
        "SELECT * FROM api.county_signal_pack WHERE county_fips = :f ORDER BY variable_id",
        f=county_fips)
    rows = _jsonable(rows)
    if format == "csv":
        return _csv_response(rows, f"county_{county_fips}_variables.csv")
    return {"county_fips": county_fips, "variables": rows}


@app.get("/v1/counties/{county_fips}/signal-pack", dependencies=[Depends(require_api_key)])
def county_signal_pack(county_fips: str, request: Request):
    _county_or_404(request, county_fips)
    return {"county_fips": county_fips,
            "signal_pack": _jsonable(query_rows(
                "SELECT * FROM api.county_signal_pack WHERE county_fips = :f "
                "ORDER BY variable_id", f=county_fips))}


# --- variables ---------------------------------------------------------------

@app.get("/v1/variables", dependencies=[Depends(require_api_key)])
def variable_dictionary(page: dict = Depends(pagination)):
    return {"variables": _jsonable(query_rows(
        "SELECT * FROM api.variable_dictionary ORDER BY variable_id "
        "LIMIT :limit OFFSET :offset", **page)), **page}


# --- events ------------------------------------------------------------------

@app.get("/v1/events", dependencies=[Depends(require_api_key)])
def list_events():
    return {"events": _jsonable(query_rows(
        "SELECT * FROM api.events ORDER BY event_id"))}


@app.get("/v1/events/{event_id}", dependencies=[Depends(require_api_key)])
def get_event(event_id: str, request: Request):
    rows = query_rows("SELECT * FROM api.events WHERE event_id = :e", e=event_id)
    if not rows:
        raise HTTPException(404, detail=structured_error(
            request, "event_not_found", f"no event {event_id}"))
    return _jsonable(rows)[0]


@app.get("/v1/events/{event_id}/occurrences", dependencies=[Depends(require_api_key)])
def event_occurrences(event_id: str, page: dict = Depends(pagination)):
    return {"event_id": event_id, "occurrences": _jsonable(query_rows(
        """SELECT county_fips, county_name, state_abbr, period, trigger_value
           FROM api.event_scorecards WHERE event_id = :e
           ORDER BY period DESC, county_fips LIMIT :limit OFFSET :offset""",
        e=event_id, **page)), **page}


@app.get("/v1/events/{event_id}/scorecards", dependencies=[Depends(require_api_key)])
def event_scorecards(event_id: str,
                     format: str = Query("json", pattern="^(json|csv)$"),
                     page: dict = Depends(pagination)):
    rows = _jsonable(query_rows(
        """SELECT * FROM api.event_scorecards WHERE event_id = :e
           ORDER BY period DESC, county_fips LIMIT :limit OFFSET :offset""",
        e=event_id, **page))
    if format == "csv":
        return _csv_response(rows, f"event_{event_id}_scorecards.csv")
    return {"event_id": event_id, "scorecards": rows, **page}


# --- experiments ---------------------------------------------------------------

@app.get("/v1/experiments", dependencies=[Depends(require_api_key)])
def list_experiments(page: dict = Depends(pagination)):
    return {"experiments": _jsonable(query_rows(
        "SELECT * FROM api.experiments ORDER BY experiment_id DESC, model_id "
        "LIMIT :limit OFFSET :offset", **page)), **page}


@app.get("/v1/experiments/{experiment_id}", dependencies=[Depends(require_api_key)])
def get_experiment(experiment_id: int, request: Request):
    rows = query_rows("SELECT * FROM api.experiments WHERE experiment_id = :e",
                      e=experiment_id)
    if not rows:
        raise HTTPException(404, detail=structured_error(
            request, "experiment_not_found", f"no experiment {experiment_id}"))
    return {"experiment": _jsonable(rows)}


@app.get("/v1/experiments/{experiment_id}/top-variables",
         dependencies=[Depends(require_api_key)])
def experiment_top_variables(experiment_id: int,
                             limit: int = Query(25, ge=1, le=200)):
    return {"experiment_id": experiment_id, "top_variables": _jsonable(query_rows(
        """SELECT * FROM api.experiment_top_variables
           WHERE experiment_id = :e
             AND model_id = (SELECT model_id FROM api.experiments
                             WHERE experiment_id = :e AND NOT is_baseline
                             ORDER BY (metrics->>'auc')::numeric DESC NULLS LAST
                             LIMIT 1)
           ORDER BY rank LIMIT :limit""", e=experiment_id, limit=limit))}


# --- scores / rankings ---------------------------------------------------------

@app.get("/v1/scores/{recipe_id}", dependencies=[Depends(require_api_key)])
def recipe_scores(recipe_id: str,
                  period: str | None = None,
                  format: str = Query("json", pattern="^(json|csv)$"),
                  page: dict = Depends(pagination)):
    sql = "SELECT * FROM api.county_scores WHERE recipe_id = :r"
    if period:
        sql += " AND period = :period"
    sql += " ORDER BY period DESC, rank_national LIMIT :limit OFFSET :offset"
    rows = _jsonable(query_rows(sql, r=recipe_id, period=period, **page))
    if format == "csv":
        return _csv_response(rows, f"scores_{recipe_id}.csv")
    return {"recipe_id": recipe_id, "scores": rows, **page}


@app.get("/v1/rankings/counties", dependencies=[Depends(require_api_key)])
def county_rankings(recipe_id: str,
                    period: str | None = None,
                    state: str | None = None,
                    page: dict = Depends(pagination)):
    sql = "SELECT * FROM api.county_rankings WHERE recipe_id = :r"
    if period:
        sql += " AND period = :period"
    if state:
        sql += " AND state_abbr = upper(:state)"
    sql += " ORDER BY rank_national LIMIT :limit OFFSET :offset"
    return {"rankings": _jsonable(query_rows(
        sql, r=recipe_id, period=period, state=state, **page)), **page}


# --- provenance -----------------------------------------------------------------

@app.get("/v1/provenance/{record_id}", dependencies=[Depends(require_api_key)])
def provenance(record_id: str, request: Request):
    """record_id format: {county_fips}:{variable_id}[:{period_start}]"""
    parts = record_id.split(":")
    if len(parts) < 2:
        raise HTTPException(422, detail=structured_error(
            request, "bad_record_id",
            "expected {county_fips}:{variable_id}[:{YYYY-MM-DD}]"))
    county_fips, variable_id = parts[0], parts[1]
    sql = """SELECT * FROM api.provenance
             WHERE county_fips = :f AND variable_id = :v"""
    params = {"f": county_fips, "v": variable_id}
    if len(parts) > 2:
        sql += " AND period_start = :p"
        params["p"] = parts[2]
    sql += " ORDER BY period_start DESC LIMIT 100"
    rows = query_rows(sql, **params)
    if not rows:
        raise HTTPException(404, detail=structured_error(
            request, "provenance_not_found", f"no observations for {record_id}"))
    return {"record_id": record_id, "provenance": _jsonable(rows)}
