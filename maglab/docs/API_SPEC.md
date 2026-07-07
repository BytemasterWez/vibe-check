# MagLab Backend API Specification (v1 target — built in Phase 7)

Base URL configurable per deployment. All routes except `/health` and
`/auth/activate` require `Authorization: Bearer <api_token>`. Admin routes
require an admin token. Payload field definitions: `DATA_DICTIONARY.md`
and `backend/app/schemas.py`.

Idempotency rule: every object carries its device-generated UUID primary
key; re-uploading an existing UUID is a no-op, never a duplicate row.

## Health

### GET /health  *(live now)*
`200 {"status": "ok", "service": "maglab-backend", "version": "0.1.0"}`

## Auth

### POST /auth/activate
Exchange an invite code for a contributor token.

Request: `{"invite_code": "...", "pseudonym": "...", "consent_version": "consent-v1"}`
Response: `{"contributor_id": "<uuid>", "api_token": "<token>"}` — token
shown once; only its hash is stored.

### POST /auth/check
Validate the bearer token. Response:
`{"contributor_id": "<uuid>", "is_active": true, "consent_version": "consent-v1"}`

## Surveys

### POST /surveys/upload
Upload a survey package (survey metadata + runs). Body:
`SurveyPackageUpload` — must include contributor consent metadata
(consent_version, share_precision, app_version, device_model).
Server rejects `share_setting = private_local_only` with `403`.

### GET /surveys
List surveys (contributors see their own; admin sees all).

### GET /surveys/{survey_id}
Survey detail with run summaries.

## Samples

### POST /samples/bulk
Body: `{"samples": [SampleUpload, ...]}`. Batched (suggest ≤ 2,000/request),
gzip accepted. Response: `{"received": n, "inserted": m, "duplicates": n-m}`.

### GET /samples?survey_id=<uuid>
Samples for one survey (paginated).

## Markers

### POST /markers/bulk — `{"markers": [MarkerUpload, ...]}`
### GET /markers?survey_id=<uuid>

## Anomalies

### POST /anomalies/bulk — `{"anomalies": [AnomalyEventUpload, ...]}`
### GET /anomalies?survey_id=<uuid>

## Admin

### GET /admin/stats
Contributor/survey/run/sample/anomaly counts, last-upload times.

### GET /admin/export/csv?table=sensor_samples
Streams CSV in the DATA_DICTIONARY column order.

### GET /admin/export/geojson
Anomaly events + survey tracks as GeoJSON FeatureCollections.

### GET /admin/export/parquet?table=sensor_samples
Parquet file per table, for `analysis/scripts/pull_backend_to_duckdb.py`.

### GET /admin/export/survey_package?survey_id=<uuid>
Full survey package JSON re-export.

## Sync client rules (iOS side)

- Never upload without consent; never upload private local-only surveys.
- Use the API token; compress payloads where practical.
- Retry failed uploads with backoff; keep local data on failure.
- Track per-survey sync status; support manual retry.
- Deduplication is guaranteed by UUID keys, so retries are always safe.

## Error conventions

`401` bad/missing token · `403` consent/share-setting violation ·
`409` schema-version mismatch · `422` validation failure ·
`501` route not yet implemented (current state of all Phase 7 routes).
