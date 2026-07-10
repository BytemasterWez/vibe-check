# AeroRisk Due Diligence

Public-record aircraft/operator risk intelligence. **N-number in → evidence-backed report out.**

AeroRisk identifies public safety, maintenance, compliance, utilisation, ownership, and
operational risk signals around aircraft and aviation operators, for buyers, brokers, lenders,
insurers, charter customers, maintenance shops, and aviation lawyers.

It does **not** say *"this aircraft is unsafe."* It says *"these public records suggest issues
worth reviewing before a financial, legal, insurance, maintenance, or charter decision."*
That wording is enforced in code and tests, not just in copy — see
[Language guardrails](#language-guardrails).

The product thesis, buyer segments, pricing, and validation gates live in the companion spec:
[`../docs/aerorisk-due-diligence.md`](../docs/aerorisk-due-diligence.md). This directory is the
self-contained implementation: a zero-dependency Node.js CLI that turns a data directory of
public-record CSV feeds into the **Aircraft Due-Diligence Pack** — the 10-section report the
spec defines. Markdown out; PDF is a render step on top (`pandoc report.md -o report.pdf`).

## Quick start

Requires Node.js ≥ 18. No `npm install` needed — there are zero runtime dependencies.

```sh
cd aerorisk

# What's in the bundled sample dataset?
node bin/aerorisk.js list

# Generate a due-diligence pack (markdown to stdout)
node bin/aerorisk.js report N789EF

# Write it to a file / get the structured assessment as JSON
node bin/aerorisk.js report N789EF --out pack-N789EF.md
node bin/aerorisk.js report N789EF --json

# Run against your own data directory (schemas below)
node bin/aerorisk.js report N789EF --data /path/to/data

# List the public data sources; download the ones with bulk endpoints
node bin/aerorisk.js sources
node bin/aerorisk.js fetch faa-registry --dest data/live

# Tests
npm test
```

The bundled `data/sample/` dataset is **synthetic** — realistic in shape (it mirrors the real
feed schemas) but fictional in content, covering three profiles: a clean late-model aircraft
(N456CD), a flight-school trainer with model-level themes (N123AB), and a high-signal charter
aircraft with registration churn, tail-specific SDRs, an NTSB event, enforcement matches, and a
pre-sale repositioning pattern (N789EF).

## How it works

```
N-number
   │  src/identity.js          Module 1 — resolve identity, rate match confidence
   ▼
Datastore (data dir of CSVs)   src/datastore.js — lookups over the public-record feeds
   │
   ├─ src/modules/registration.js    ownership churn, trusts, registration recency
   ├─ src/modules/maintenance.js     Module 2 — SDR fingerprint (tail vs model, JASC themes)
   ├─ src/modules/accidents.js       Module 3 — NTSB direct matches + model-level cause themes
   ├─ src/modules/adExposure.js      Module 4 — applicable ADs + compliance document checklist
   ├─ src/modules/utilisation.js     Module 5 — activity, inactivity, training/repositioning patterns
   ├─ src/modules/enforcement.js     Module 6 — public enforcement history (name-matched, caveated)
   ├─ src/modules/humanFactors.js    Module 7 — ASRS themes (voluntary/unverified, lowest weight)
   └─ src/modules/airportContext.js  Module 8 — runway incursion + wildlife-strike context
   │
   ▼
src/scoring.js    weighted composite 0–100 + sub-scores + spec score bands
src/assess.js     orchestrates modules into one assessment object
src/report.js     renders the 10-section Aircraft Due-Diligence Pack (markdown)
```

Every finding carries an evidence list referencing the originating public record
(SDR report ID, NTSB event ID, AD number, enforcement case ID, ASRS ACN) so a human can verify
each claim at the source.

### Scoring

Composite = weighted sub-scores (weights in `src/scoring.js`): maintenance 20%, accidents 20%,
AD exposure 15%, enforcement 15%, registration 10%, utilisation 10%, human factors 5%, airport
exposure 5%. Identity confidence and report confidence are reported separately — they qualify
the evidence, they are not risk.

| Score | Band |
| --- | --- |
| 0–20 | Low public risk signal |
| 21–40 | Some review points |
| 41–60 | Material due-diligence questions |
| 61–80 | High review priority |
| 81–100 | Serious public-risk concentration; manual expert review recommended |

### Language guardrails

Enforced by `test/pipeline.test.js` and `test/scoring.test.js`:

- Reports never say an aircraft is "safe" or "unsafe"; the only summary phrasing is
  *"Public records show low/moderate/high review priority."*
- Model-level SDR/NTSB evidence is always separated from tail-specific evidence and labelled
  *"not a defect claim against this aircraft."*
- Enforcement matches are labelled *"public enforcement history"* with an explicit
  name-match caveat — never "bad operator."
- ASRS output is labelled *"human-factors theme"* with the voluntary/unverified caveat on every
  finding — never a judgement about a pilot or training programme.
- AD findings describe *exposure*, never non-compliance (compliance evidence is not public).
- Every report opens with a disclaimer that it is not a safety certification, airworthiness
  determination, or accusation.

### Deliberate non-goals

Per the spec, this project must never become: a celebrity/private-jet tracker, live tracking of
any kind, a pilot-risk score, a public accusation engine, or anything touching the
access-controlled FAA Pilot Records Database. Registry records can contain PII and the FAA
allows owners to request withholding — treat registrant fields as display-sensitive when this
grows a public surface.

## Data directory schemas

A data directory is a folder of CSV files (all optional — missing feeds degrade to
low-confidence "no data" findings):

| File | One row per | Key columns |
| --- | --- | --- |
| `registry.csv` | aircraft | `N_NUMBER, SERIAL_NUMBER, MFR, MODEL, ENG_MFR, ENG_MODEL, YEAR_MFR, REGISTRANT_TYPE, REGISTRANT_NAME, CITY, STATE, CERT_ISSUE_DATE, AIRWORTHINESS_CLASS, STATUS, MODE_S_HEX, EXPIRATION_DATE` |
| `registration_history.csv` | registration event | `N_NUMBER, DATE, EVENT, DETAILS` |
| `sdr.csv` | service difficulty report | `REPORT_ID, DATE, N_NUMBER, MFR, MODEL, JASC_CODE, JASC_DESCRIPTION, PART_NAME, SEVERITY, NARRATIVE` |
| `ntsb.csv` | accident/incident | `EVENT_ID, DATE, N_NUMBER, SERIAL_NUMBER, MFR, MODEL, OPERATOR, CITY, STATE, AIRPORT, HIGHEST_INJURY, DAMAGE, STATUS, PROBABLE_CAUSE` |
| `ads.csv` | airworthiness directive | `AD_NUMBER, EFFECTIVE_DATE, SUBJECT, APPLIES_MFR, APPLIES_MODEL, APPLIES_ENG_MFR, APPLIES_ENG_MODEL, RECURRING, COST_BAND, NOTES` (model fields match on prefix: `PA-31` applies to `PA-31-350`) |
| `enforcement.csv` | closed FAA action | `CASE_ID, DATE_CLOSED, RESPONDENT, RESPONDENT_TYPE, ACTION (civil_penalty\|suspension\|revocation), AMOUNT, SUMMARY` |
| `asrs.csv` | ASRS narrative | `ACN, DATE, MFR, MODEL, AIRPORT, THEMES (semicolon-separated), SYNOPSIS` |
| `airport_risk.csv` | airport | `AIRPORT, NAME, RUNWAY_INCURSIONS_5YR, WILDLIFE_STRIKES_5YR, COASTAL, NOTES` |
| `flights.csv` | historical flight | `N_NUMBER, DATE, ORIGIN, DEST, DURATION_MIN` |

## Automated ingestion (V1)

`aerorisk ingest` is the automation layer: manual work belongs at the human
review layer, not at ingestion. Each source adapter runs the same contract —
**discover → fetch → checksum/store raw → transform → validate → load staging
→ promote → emit health record** — and a blocked source never stops the others.

```sh
# Full run (registry first — SDR/NTSB/AD layers read the promoted registry)
node bin/aerorisk.js ingest all --base ./data/ingest

# Individual sources
node bin/aerorisk.js ingest faa-registry
node bin/aerorisk.js ingest faa-sdr --years 1995:current
node bin/aerorisk.js ingest ntsb --tails N123AB,N789EF          # api mode
node bin/aerorisk.js ingest ntsb --mode bulk --bulk-url <url>   # bulk mode
node bin/aerorisk.js ingest faa-ad --ad-pages 3                 # Federal Register
node bin/aerorisk.js ingest faa-enforcement --offline ./exports/faa_enforcement
node bin/aerorisk.js ingest asrs --offline ./exports/asrs

# Offline mode: local files instead of the network (for "all", one
# subdirectory per source: faa_registry/ faa_sdr/ ntsb/ faa_ad/
# faa_enforcement/ asrs/)
node bin/aerorisk.js ingest all --offline ./exports --base ./data/ingest

# Preflight FIRST on any new network: probes every real endpoint and checks
# each response parses into the shape the adapter expects (see LIVE_RUN.md)
node bin/aerorisk.js doctor

# Reports read straight from the promoted production tables
node bin/aerorisk.js report N789EF --data ./data/ingest/db/production

# Batch enrichment (the V1 target): many N-numbers → scored records + gate
node bin/aerorisk.js batch tails.txt --data ./data/ingest/db/production --out-dir ./out
```

Layout under `--base`:

```
raw/<source>/<YYYY-MM-DD>/artifact + artifact.meta.json   sha256, size, URL, HTTP status
db/staging/<source>/*.csv     written by adapters, validated before promotion
db/production/*.csv           only touched by a successful promote
db/schemas/<source>.json      column fingerprints for schema-change detection
db/source_health.csv          every run, success or failure — no silent failures
reports/ingestion_health/YYYY-MM-DD.md   daily health report
```

Adapter status:

- **faa-registry** — page-discovers the zip link (canonical URL fallback);
  parses the full bundle (MASTER, ACFTREF, ENGINE, DEREG, DOCINDEX, DEALER,
  RESERVED) and derives a registration-history view from deregistrations.
- **faa-sdr** — crawls yearly CSV links, downloads missing/changed years only,
  flexible column mapping across year layouts, aircraft match layer with
  confidence tiers `EXACT_N_NUMBER → SERIAL_MATCH → MAKE_MODEL_ENGINE_MATCH →
  MODEL_ONLY → WEAK_TEXT_MATCH → NO_MATCH`, JASC model-pattern summaries.
- **ntsb** — API mode (targeted N-number queries) and bulk mode; defensive
  field extraction over CAROL-style JSON/CSV. The exact live API shape is
  unverified from this sandbox; unmapped shapes surface as warnings.
- **faa-ad** — api mode discovers FAA AD final rules via the Federal Register
  public JSON API; offline mode loads a structured AD CSV as authoritative.
  Text-match applicability from AD prose is tagged `TEXT_MATCH` and reported
  low-confidence; structured loads are `STRUCTURED`/high. Wording stays "AD
  exposure", never "AD non-compliance".
- **faa-enforcement** — offline/structured-first (quarterly compilations have
  no clean bulk API); categorises actions (maintenance/operational/drug-
  testing/hazmat/certificate) and rolls entities up with counts. Operator
  risk, labelled "public enforcement history".
- **asrs** — offline/structured-first (10k-record export windows, no open bulk
  API); flexible header mapping, theme summarisation. Capped at low confidence
  by design — voluntary, unverified, human-factors themes only.
- **runway-incursions** — offline/structured-first ASIAS event export;
  aggregates 5-year incursion counts per airport and merges into the shared
  airport_risk view. Airport surface-risk context, not aircraft/operator blame.
- **wildlife-strikes** — offline/structured-first FAA Wildlife Strike Database
  export; 5-year strike and damaging-strike counts per airport plus a species
  summary, merged into airport_risk. Airport/model exposure, not accusation.

The runway-incursion and wildlife adapters each own one column of the shared
`airport_risk` view and merge (never clobber) — runway runs first so wildlife
merges on top. Health statuses: `OK, OK_WITH_WARNINGS, SOURCE_UNAVAILABLE,
SCHEMA_CHANGED, ZERO_ROWS, VALIDATION_FAILED, BLOCKED, PARTIAL`. A schema
change blocks promotion until re-run with `--accept-schema-change`.

All eight adapters from the ingestion spec are now implemented.

### Docker

```sh
docker build -t aerorisk .
docker run --rm -v aerorisk-data:/data aerorisk ingest all --base /data
docker run --rm -v aerorisk-data:/data aerorisk report N123AB --data /data/db/production
```

Nightly cron (FAA registry refreshes daily at 23:30 Central):
`30 5 * * * docker run --rm -v aerorisk-data:/data aerorisk ingest all --base /data`

## Loading real data

`node bin/aerorisk.js sources` lists the real public feeds. Summary:

| Source | Feed(s) | Acquisition |
| --- | --- | --- |
| FAA aircraft registry (Releasable Aircraft DB, daily) | `registry.csv` | `aerorisk fetch faa-registry`, unzip, then `aerorisk transform faa-registry --src <dir> --dest <data-dir>` |
| FAA Service Difficulty Reports (yearly CSVs) | `sdr.csv` | manual export from sdrs.faa.gov |
| NTSB CAROL (1962–present) | `ntsb.csv` | manual export from data.ntsb.gov |
| FAA Airworthiness Directives (DRS) | `ads.csv` | manual export from drs.faa.gov |
| FAA quarterly enforcement compilations | `enforcement.csv` | manual transform of quarterly reports |
| NASA ASRS database exports | `asrs.csv` | manual export from asrs.arc.nasa.gov |
| FAA ASIAS runway incursions + FAA Wildlife Strike DB | `airport_risk.csv` | manual aggregation per airport |
| Flight activity | `flights.csv` | **licensed** ADS-B export or operator logs only |

The releasable registry DB carries only the *current* registrant; a full chain-of-ownership
timeline (`registration_history.csv`) requires FAA aircraft records requests (CARES) and is not
produced by the transform.

**Network note:** all Tier-1 sources are public, unauthenticated endpoints — no API keys.
`aerorisk fetch` needs an environment whose network policy allows the government hosts
(`registry.faa.gov`, `sdrs.faa.gov`, `data.ntsb.gov`, `drs.faa.gov`, `asrs.arc.nasa.gov`,
`wildlife.faa.gov`, `asias.faa.gov`). In restricted/proxied sandboxes the download fails with a
clear error and the rest of the tool keeps working from local data.

**ADS-B licensing is not optional.** OpenSky requires a written licence for commercial use;
ADS-B Exchange data is a licensed product. Load only flight-activity data you have the rights
to use commercially. The MVP is fully functional without it — utilisation simply reports as
unavailable.

## Roadmap (matches the spec's phases)

- **Phase 1 (this code): manual-first report service.** Analyst loads/refreshes the data
  directory, runs `aerorisk report`, reviews and hand-finishes the pack, sells it.
- **Phase 2: dashboard** — search, watchlists, alerts on new SDR/AD/NTSB/enforcement records.
  Only after paid reports prove demand.
- **Phase 3: enrichment API** for brokers, marketplaces, insurers, lenders. Not before.

Validation gates and kill criteria are in the spec — the first target is one paid report at
$500+ within 30 outreach attempts.
