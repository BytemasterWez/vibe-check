# CapabilityProof (SourceProof wedge)

A live capability-verification API for agents. It answers the question agent
registries and catalogues don't:

> "Can this data source reliably perform this specific task **right now** —
> and what evidence proves it?"

Positioning, precisely: existing monitoring verifies infrastructure the
customer owns or configures. CapabilityProof **independently verifies
external data capabilities** — sources you depend on but don't control — and
publishes **portable, machine-verifiable evidence** that software and agents
can consult *before* selecting a source. It runs a live probe against a
versioned verification contract, validates the response semantically (not
just HTTP 200), and issues a signed, short-lived, tamper-evident capability
receipt hash-linked to retained evidence.

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

## Telegram alerts + daily report

Set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` and you get:

- **instant alerts** when a capability starts failing, recovers, or drifts
  (🔴/🟢/🟡 messages with the failing checks and fallback order), plus doctor
  escalations;
- **a daily report** (`npm run capabilityproof:report`): verified counts,
  quarantine size, fleet median/p95 latency, average 30-day success, drift —
  also written as markdown to `data/reports/`.

One-time setup: create a bot with @BotFather in Telegram, export the token,
message your bot once, then `node capabilityproof/report.mjs setup-telegram`
prints your chat id. Confirm with `node capabilityproof/report.mjs test`.

## Doctor (24/7 watchdog)

`npm run capabilityproof:doctor` distinguishes *a source is broken* (normal,
covered by receipts and alerts) from *our system is broken* and only
escalates the latter: manifests load, data dir writable, signing keys
readable, disk space, sweep recency, API liveness (auto-restarts the systemd
service when possible), LLM reachability (informational). Critical failures
alert via Telegram and exit non-zero for systemd.

## Run 24/7 on a VPS

One command on a fresh Ubuntu/Debian server:

```bash
sudo bash capabilityproof/ops/install.sh                # verification system only (~$5/mo VPS)
sudo bash capabilityproof/ops/install.sh --with-ollama  # + local LLM for Scout drafting (needs ~8GB RAM)
```

Installs Node, the app under `/opt/capabilityproof`, and systemd units: the
API + dashboard on :3200 (auto-restart), a daily sweep + quarantine sweep +
report timer, a doctor timer every 15 minutes, and (with `--with-ollama`)
Ollama serving `qwen2.5:3b` — the smallest model that drafts reliable JSON —
plus a weekly Scout discovery timer. Configuration lives in
`/etc/capabilityproof.env`. The Scout code is endpoint-agnostic: LM Studio on
a PC and Ollama on a VPS both speak the same OpenAI-compatible API.

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

What the signature does and does not prove: it proves this system issued the
receipt and that it has not been altered since (tamper-evident, not
"tamper-proof"), and the `evidence_hash` binds it to a retained raw sample.
It does not by itself prove the test was well designed or that the source is
still healthy after expiry — which is why receipts carry a
`contract_version` (exactly what was asserted), a `runner_version` (exactly
what code ran), short expiries, and replayable evidence.

## Contracts, policies and the resolver

**Versioned contracts.** Each capability's test pack is its verification
contract, with an explicit `contract_version` named in every receipt.
`GET /v1/capabilities/:id/contract` shows exactly what "verified" asserts —
the contract is transparent, not proprietary magic.

**Evidence replay.** Every receipt can be reproduced:
`node capabilityproof/cli.mjs replay <receipt_id>` (or
`POST /v1/receipts/:id/replay`) checks the stored evidence is still
hash-bound to the receipt, re-runs the recorded contract against the live
source, and diffs the outcomes. A receipt is a reproducible measurement, not
an attractive signed claim.

**Trust policies.** Different consumers, different risk tolerances. Named
policies (`production`, `standard`, `permissive` — see `GET /v1/policies`)
or custom rules gate on receipt age, consecutive clean passes, 30-day
success rate, confidence, and whether experimental (Scout-admitted,
not-yet-human-approved) sources are acceptable. Confidence is a documented
formula (60% latest check ratio, 40% 30-day success rate), not a mystery
score.

**The resolver — the machine decision.** `POST /v1/resolve`:

```json
{
  "decision": "approved",
  "capability_id": "source.census.acs5_county_population",
  "receipt_id": "cpr_...",
  "receipt_valid_until": "2026-07-10T23:42:00Z",
  "contract_version": "1.0.0",
  "confidence": 0.97,
  "instructions": { "request": { "...": "..." } },
  "fallbacks": [{ "capability_id": "source.worldbank.country_population", "confidence": 0.92 }],
  "policy": { "name": "production" }
}
```

Rejections list every violated rule per candidate. `POST /v1/resolve-and-fetch`
goes one step further: resolve, then execute the call against the approved
source and return the data with the receipt attached (caller params only fill
`{placeholders}` in the manifest's own endpoint template — hosts are never
caller-controlled).

**SDK.** `sdk/client.mjs` is a zero-dependency client:

```js
import { CapabilityProof } from './capabilityproof/sdk/client.mjs';
const cp = new CapabilityProof('http://localhost:3200');
const { resolution, fetch } = await cp.resolveAndFetch({
  task: 'county population',
  policy: 'production',
});
```

## Failure-injection benchmark

`npm run capabilityproof:bench` injects ten realistic failure modes (HTTP-200
HTML, 25% truncation, stale timestamps, renamed fields, duplicated rows,
impossible values, rate-limit-as-200, partial geography, wrong vintage,
broken join keys) plus two healthy controls, and scores detection rate,
false positives and per-dimension classification. Current score: **10/10
detected, 0 false positives, 10/10 correctly classified.** Runs offline and
in CI.

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

Current inventory (26 sources, 9 categories, all read-only — rows marked ⚭
were discovered and qualified automatically by the Scout):

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
| `source.nws.active_alerts` ⚭ | hazards | none |
| `source.census.geocoder_address` ⚭ | geospatial | none |
| `source.usgs.point_elevation` ⚭ | geospatial | none |
| `source.frankfurter.ecb_rates` ⚭ | economic | none |
| `source.coingecko.simple_price` ⚭ | economic | none |
| `source.openmeteo.air_quality` ⚭ | environment | none |
| `source.noaa.tides_water_level` ⚭ | environment | none |
| `source.openlibrary.book_search` ⚭ | reference | none |
| `source.restcountries.country_reference` ⚭ | reference | none |
| `source.openfda.drug_events` ⚭ | health | none |

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
  scout.mjs           automated source discovery + quarantine + promotion
  scout/              candidate leads for the Scout
  report.mjs          daily key-metrics digest (Telegram + markdown)
  doctor.mjs          self-healing watchdog for unattended operation
  ops/install.sh      one-command 24/7 VPS installer (systemd, optional Ollama)
  sdk/client.mjs      zero-dependency JS client (resolve, resolve-and-fetch, receipts)
  bench/              failure-injection benchmark (detection scorecard)
  manifests/          verified capability manifests
  manifests-proposed/ quarantine for scouted, not-yet-promoted sources
  lib/
    manifest.mjs      manifest schema, validation, env substitution
    probe.mjs         live HTTP probes
    evaluate.mjs      deterministic check engine + schema-shape hashing
    receipts.mjs      ed25519-signed, short-lived receipts
    store.mjs         file-based receipts/evidence/history store
    registry.mjs      task search, constraint filtering, evidence-first ranking
    policy.mjs        trust policies, transparent confidence, decision gating
    service.mjs       orchestration shared by REST, MCP and CLI
    notify.mjs        status-change and schema-drift webhooks
    dashboard.mjs     server-rendered HTML status page with fleet metrics
    llm.mjs           OpenAI-compatible client for local models (LM Studio, Ollama)
    telegram.mjs      Telegram Bot API transport for alerts and reports
  test/smoke.mjs      offline end-to-end test with mock sources
  data/               runtime state: keys, receipts, evidence, history (git-ignored)
```

## Scout: automated source discovery

The Scout qualifies new sources without letting anything unverified into the
catalogue:

```
candidate lead -> live probe -> draft manifest -> validate -> live verify
              -> quarantine (manifests-proposed/) -> promote after a clean streak
```

```bash
npm run capabilityproof:scout               # discover: qualify new candidates
node capabilityproof/scout.mjs status       # quarantine streaks
node capabilityproof/scout.mjs verify-proposed   # re-verify quarantined sources
node capabilityproof/scout.mjs promote --ready   # graduate clean-streak sources
```

The Scout **generates candidate contracts; it never certifies a source.**
Promoted sources stay marked *experimental* — excluded by strict trust
policies — until a human runs `node capabilityproof/scout.mjs approve <id>`.

Manifest drafting uses a **local LLM when one is running** — any
OpenAI-compatible server works, e.g. LM Studio serving Gemma at
`http://localhost:1234/v1` (override with `CAPABILITYPROOF_LLM_URL` /
`CAPABILITYPROOF_LLM_MODEL`). Without a model it falls back to deterministic
drafting (row detection, fields required only if present in every sampled
row). Either way the model only *drafts*: it cannot set trust-relevant fields
(auth, cost, risk class, probe URL), invalid check types are filtered, and
live verification plus the quarantine streak (default 3, set
`CAPABILITYPROOF_SCOUT_STREAK`) decide what gets promoted.

Candidate leads live in `scout/candidates.json` — add entries there to give
the Scout more ground to cover.

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
