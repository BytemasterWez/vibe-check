# API reference

Base: FastAPI service, OpenAPI docs at `/docs`. All `/v1` routes require
`X-API-Key`. Responses carry `X-Request-ID`; errors are structured:
`{"error": code, "message": …, "request_id": …}`. Pagination via
`limit` (≤1000) and `offset`. Rate limit per key: `CSE_RATE_LIMIT_PER_MINUTE`
(default 120/min; HTTP 429 beyond).

The service connects with the **read-only role** (`CSE_API_DATABASE_URL`)
and reads only `api.*` views. No raw internal table is reachable through
it, and no database credentials are ever exposed in responses.

## Endpoints

| Endpoint | Returns |
|---|---|
| `GET /health` | `{"status": "READY"}` + DB check (open) |
| `GET /version` | engine + API version (open) |
| `GET /v1/sources` | registered sources with lifecycle status |
| `GET /v1/source-health` | freshness, join rate, failure counts per source |
| `GET /v1/counties?state=LA` | county list (filter by state abbr or FIPS) |
| `GET /v1/counties/{fips}` | one county profile row |
| `GET /v1/counties/{fips}/profile` | county + latest signals + recent scores |
| `GET /v1/counties/{fips}/variables` | latest value per variable (`?format=csv`) |
| `GET /v1/counties/{fips}/signal-pack` | the signal-pack payload |
| `GET /v1/variables` | variable dictionary |
| `GET /v1/events` | declared events |
| `GET /v1/events/{event_id}` | one event definition |
| `GET /v1/events/{event_id}/occurrences` | county-period occurrences |
| `GET /v1/events/{event_id}/scorecards` | occurrence scorecards (`?format=csv`) |
| `GET /v1/experiments` | experiment runs + models + metrics |
| `GET /v1/experiments/{id}` | one experiment |
| `GET /v1/experiments/{id}/top-variables` | ranked variables of the best model |
| `GET /v1/scores/{recipe_id}` | county scores for a recipe (`?period=`, `?format=csv`) |
| `GET /v1/rankings/counties?recipe_id=` | national/state rankings (`?state=`, `?period=`) |
| `GET /v1/provenance/{record_id}` | full provenance chain; `record_id` = `{county_fips}:{variable_id}[:{YYYY-MM-DD}]` |

## Example

```bash
curl -H "X-API-Key: $KEY" \
  "https://…/v1/provenance/22103:bls_laus_unemployment_rate:2025-12-01"
```

returns the observation with its join confidence, ingestion run, raw
artifact URL, sha256 content hash, retrieval timestamp and licence status —
enough to rebuild or dispute the number.

## Usage logging

Every request is logged to `audit.api_usage` (request id, hashed API key,
path, status, duration). The API key itself is never stored.
