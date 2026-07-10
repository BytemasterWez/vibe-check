# CapabilityProof (SourceProof wedge)

A live capability-verification API for agents. It answers the question agent
registries and catalogues don't:

> "Can this data source reliably perform this specific task **right now** —
> and what evidence proves it?"

Registries list claims. CapabilityProof runs a **live probe** against a
declared test pack, validates the response **semantically** (not just
HTTP 200), and issues a **signed, short-lived capability receipt** that other
software can consume and verify.

This is the constrained validation version: read-only public data sources
only (the SourceProof wedge), deterministic checks only (no LLM evaluator),
file-based evidence store, zero new dependencies beyond what the repo already
ships (`@modelcontextprotocol/sdk` for the MCP surface, node:crypto for
signing).

## What it catches that uptime monitoring misses

Real example, observed while building this: the US Census API returns
**HTTP 200 with an HTML "Missing Key" page** when called without a key. An
uptime monitor calls that healthy. CapabilityProof's receipt says:

```
status: failed_checks
failures:
  - json [availability]: body is not valid JSON (starts with: "<html><head><title>Request Rejected...")
  - min_rows [completeness]: 0 rows at "" (minimum 3000)
fallback_capability_ids: [source.worldbank.country_population]
```

The same machinery catches truncated datasets (row counts), broken join keys
(FIPS format regressions), stale data (freshness timestamps), silent schema
drift (shape hashing across probes), and implausible values (range checks).

## Quick start

```bash
npm install --ignore-scripts   # if you haven't already

npm run capabilityproof:test     # offline smoke test (mock sources, 18 assertions)
npm run capabilityproof:verify   # live verification sweep of all seed sources
npm run capabilityproof:api      # REST API on :3200
npm run capabilityproof:mcp      # MCP server on stdio
```

CLI:

```bash
node capabilityproof/cli.mjs list
node capabilityproof/cli.mjs verify source.usgs.earthquakes_all_day
node capabilityproof/cli.mjs search "county population by FIPS"
node capabilityproof/cli.mjs route "county population by FIPS"
node capabilityproof/cli.mjs explain source.census.acs5_county_population
node capabilityproof/cli.mjs receipt cpr_...
```

## REST API

| Route | Purpose |
| --- | --- |
| `GET /` | Human status dashboard (auto-refreshing HTML; no auth) |
| `POST /v1/capabilities/search` | Find capabilities by task + constraints, ranked by verified evidence |
| `POST /v1/capabilities/verify` | Live-probe one capability now; returns a signed receipt |
| `POST /v1/capabilities/route` | Pick the best verified provider + calling instructions + fallbacks |
| `POST /v1/capabilities/compare` | Side-by-side verified comparison |
| `GET /v1/receipts/:id` | Fetch a receipt (with signature validity check) |
| `GET /v1/receipts/:id/evidence` | Raw evidence sample bound to the receipt by hash |
| `GET /v1/capabilities/:id/failure` | Explain the latest failure with concrete evidence |
| `GET /v1/capabilities/:id/fallbacks` | Declared fallbacks + same-category alternatives |
| `GET /v1/capabilities` | List registered capabilities |
| `GET /v1/public-key` | Ed25519 public key for receipt verification |
| `GET /health` | Liveness + manifest problems |

Search example:

```bash
curl -s localhost:3200/v1/capabilities/search -d '{
  "task": "Retrieve current county population estimates",
  "constraints": {
    "country": "US",
    "join_keys": ["state_fips", "county_fips"],
    "maximum_cost_usd": 0.01,
    "maximum_receipt_age_minutes": 360
  }
}'
```

Set `CAPABILITYPROOF_API_KEY` to require an `x-api-key` header on `/v1/*`.

## Webhooks

Set `CAPABILITYPROOF_WEBHOOK_URL` and every verification that changes a
capability's state POSTs a JSON event to it:

- `capability_status_changed` — outage, recovery, or first verification
  (`from`/`to` status, the failing checks, and the fallback order)
- `capability_schema_drift` — the response shape hash changed between probes,
  even if all checks still pass

Delivery failures are logged and never fail the verification itself.

## MCP tools

`search_capabilities`, `verify_capability`, `compare_capabilities`,
`route_task`, `get_capability_receipt`, `explain_failure`, `find_fallback`.

Register with any MCP client:

```json
{
  "mcpServers": {
    "capabilityproof": {
      "command": "node",
      "args": ["capabilityproof/mcp-server.mjs"]
    }
  }
}
```

## Capability receipts

Receipts are signed with a locally generated ed25519 key
(`capabilityproof/data/keys/`, created on first run, git-ignored). The
`evidence_hash` binds the receipt to the stored raw evidence sample. Any
mutation of a receipt breaks its signature.

```json
{
  "receipt_id": "cpr_...",
  "capability_id": "source.usgs.earthquakes_all_day",
  "claim": "Returns all earthquakes detected worldwide in the past 24 hours...",
  "status": "verified",
  "verified_at": "2026-07-10T05:59:16Z",
  "expires_at": "2026-07-10T06:59:16Z",
  "risk_class": "read_only",
  "results": {
    "task_success": true,
    "schema_valid": true,
    "join_keys_valid": true,
    "freshness_valid": true,
    "completeness_score": 1,
    "latency_ms": 217
  },
  "history": { "success_rate_7d": 1, "success_rate_30d": 1, "schema_changes_30d": 0 },
  "fallback_capability_ids": [],
  "evidence_hash": "sha256:...",
  "signature": "ed25519:..."
}
```

Receipt statuses: `verified` (all critical checks passed), `failed_checks`
(endpoint answered but the evidence contradicts the claim), `unreachable`
(transport failure).

## Verification model

Checks are deterministic and each feeds a named dimension rather than one
opaque trust score:

| Check type | Dimension | Catches |
| --- | --- | --- |
| `status`, `json`, `max_latency` | availability | outages, HTML-instead-of-JSON, slow endpoints |
| `min_rows` | completeness | truncated or empty datasets |
| `fields_present`, `value_range` | schema | dropped columns, garbage values |
| `field_pattern` | join_keys | broken FIPS/ID formats that kill pipeline joins |
| `known_answer` | task | wrong answers to questions with known answers |
| `freshness` | freshness | stale data behind a healthy endpoint |

Schema drift is tracked separately: each probe hashes the inferred response
shape, and `schema_changes_30d` counts transitions.

## Capability manifests

One JSON file per capability in `capabilityproof/manifests/` — the claim, the
publisher, coverage, join keys, licensing, auth, cost, calling instructions,
declared fallbacks, and the test pack that proves the claim. See
`lib/manifest.mjs` for the schema and `manifests/usgs-earthquakes-all-day.json`
for a representative example. URLs may reference free keys as
`${ENV:VAR_NAME}` so secrets stay out of the repo; list those variables in
`required_env` and `verify-all --skip-missing-env` will skip (not fail) the
source when they're absent.

Seed inventory (16 sources, 7 categories, all read-only):

| Capability | Category | Auth |
| --- | --- | --- |
| `source.census.acs5_county_population` | demographics | free key (`CENSUS_API_KEY`) |
| `source.worldbank.country_population` | demographics | none |
| `source.nws.point_forecast_metadata` | weather | none |
| `source.openmeteo.hourly_forecast` | weather | none |
| `source.usgs.earthquakes_all_day` | hazards | none |
| `source.fema.disaster_declarations` | hazards | none |
| `source.fcc.census_area_lookup` | geospatial | none |
| `source.census.tigerweb_states` | geospatial (ArcGIS) | none |
| `source.zippopotam.zip_lookup` | geospatial | none |
| `source.treasury.debt_to_penny` | economic | none |
| `source.bls.unemployment_rate` | economic | none |
| `source.erapi.exchange_rates` | economic | none |
| `source.usgs.water_streamflow` | environment | none |
| `source.gbif.species_occurrences` | environment | none |
| `source.nager.public_holidays` | government | none |
| `source.usaspending.toptier_agencies` | government | none |

Test packs also encode observed real-world quirks as evidence rather than
noise: BLS publishes `"-"` for months lost to the 2025 appropriations lapse
(handled via `allow_values` missing-data sentinels), and the Census API
returns HTTP 200 HTML when unauthenticated.

## Layout

```
capabilityproof/
  api.mjs             REST API (node:http, no framework)
  mcp-server.mjs      MCP server (stdio)
  cli.mjs             local verification sweeps and inspection
  manifests/          seed capability manifests
  lib/
    manifest.mjs      manifest schema, validation, env substitution
    probe.mjs         live HTTP probes
    evaluate.mjs      deterministic check engine + schema-shape hashing
    receipts.mjs      ed25519-signed, short-lived receipts
    store.mjs         file-based receipts/evidence/history store
    registry.mjs      task search, constraint filtering, evidence-first ranking
    service.mjs       orchestration shared by REST, MCP and CLI
    notify.mjs        status-change and schema-drift webhooks
    dashboard.mjs     server-rendered HTML status page
  test/smoke.mjs      offline end-to-end test with mock sources
  data/               runtime state: keys, receipts, evidence, history (git-ignored)
```

## Scheduled sweeps

`.github/workflows/capabilityproof-sweep.yml` runs the offline smoke test and
a live `verify-all --skip-missing-env` daily (and on manual dispatch),
publishes the sweep as the job summary, and uploads receipts + evidence as a
30-day artifact. A red run means a source genuinely broke, drifted or started
lying — not that the workflow is flaky. Add `CENSUS_API_KEY` as a repo secret
to include the Census source instead of skipping it.

## Scope guardrails (by design, for the validation phase)

- Read-only sources only; no write-action verification, payments or personal data.
- Deterministic evaluation only; no LLM judge.
- File-based store; swap for Postgres when multi-tenant.
- Scheduled sweeps are just `capabilityproof:verify` in cron/CI.
