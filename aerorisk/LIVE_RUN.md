# AeroRisk — Live Run Runbook

Everything in this repo has been exercised end-to-end on fixtures and, where
the network allows, against the real endpoints. The one step that cannot be
done from a locked-down network is the live ingest. This runbook makes that
step turnkey and self-diagnosing.

## Live validation status

A first live run has been completed against the real endpoints. Results:

| Source | Live status | Notes |
| --- | --- | --- |
| **faa-ad** | ✅ validated | 100 real ADs ingested from the Federal Register API |
| **faa-registry** | ✅ validated | 314,611 real aircraft parsed (after a UTF-8 BOM fix) |
| **ntsb** | ✅ validated | CAROL is a POST API; real events ingested for real tails |
| **faa-sdr** | ⚠️ needs rework | the live site is a query app, not static yearly-CSV links |

Three findings from that run are already fixed in the code: Node `fetch` now
routes through `HTTP(S)_PROXY` automatically (`bin/aerorisk.js` re-execs with
`NODE_USE_ENV_PROXY`); the CSV parser strips the FAA files' BOM; and the NTSB
adapter POSTs the verified CAROL query body. The one open item is **faa-sdr**
(see below).

## Why a runbook is needed

The automated-discovery adapters are built against the shapes of public U.S.
aviation data. They **fail loudly** — a naming mismatch surfaces as a named
unmapped column or a `SHAPE_MISMATCH`, never as silently empty data — so
remaining fixes are small and localised. `aerorisk doctor` tells you the
current state per source in one command.

## faa-sdr: the open item

The modern `sdrs.faa.gov` is an ASP.NET query application (`Query.aspx`), not
a page of static yearly-CSV links, so the SDR adapter's link-discovery no
longer matches the live site and `doctor` reports it `SHAPE_MISMATCH`. Two ways
forward: (a) load SDR data via `ingest faa-sdr --offline <dir>` from a manual
export of `Query.aspx` results (works today), or (b) rework the adapter's
discovery to drive the query form / find the current bulk endpoint (a real
task, not a one-line mapping fix). Everything downstream of SDR is unaffected.

## Step 0 — network

Run on a connection that can reach:

```
www.faa.gov              registry.faa.gov         sdrs.faa.gov
data.ntsb.gov            www.federalregister.gov  asrs.arc.nasa.gov
wildlife.faa.gov         asias.faa.gov
```

If you are in a Claude Code remote environment, this means recreating it with a
permissive or custom-allowlist network policy (see
https://code.claude.com/docs/en/claude-code-on-the-web). On a laptop or CI box,
no change is needed.

## Step 1 — preflight (`doctor`)

```sh
node bin/aerorisk.js doctor
```

Reads each real endpoint and checks reachability **and** that the response
parses into the shape the adapter expects. Per-source outcomes:

| Status | Meaning | Action |
| --- | --- | --- |
| `REACHABLE_SHAPE_OK` | reachable, parses as expected | proceed |
| `REACHABLE_SHAPE_MISMATCH` | reachable, but layout changed | extend the adapter's `FIELD_CANDIDATES` / discovery regex (Step 3) |
| `BLOCKED` | egress policy denied it (HTTP 403/CONNECT) | fix the network (Step 0) |
| `UNREACHABLE` | DNS/timeout/5xx | transient or endpoint moved; retry, then check the URL |
| `OFFLINE_ONLY` | no live endpoint (enforcement, ASRS, ASIAS, wildlife) | load a file in Step 2b |

`doctor` exits 0 only when every network source is `REACHABLE_SHAPE_OK`.

## Step 2a — ingest the automated sources

```sh
node bin/aerorisk.js ingest faa-registry --base ./data/ingest
node bin/aerorisk.js ingest faa-sdr --years 2015:current --base ./data/ingest
node bin/aerorisk.js ingest ntsb --tails N123AB,N789EF --base ./data/ingest
node bin/aerorisk.js ingest faa-ad --ad-pages 3 --base ./data/ingest
# or all at once:
node bin/aerorisk.js ingest all --base ./data/ingest
```

Check every run's status line and the health report at
`./data/ingest/reports/ingestion_health/<date>.md`. Green statuses are `OK` and
`OK_WITH_WARNINGS`. Anything else is explained in its `error_message`.

Notes:
- **faa-registry** downloads ~290k aircraft; a row count far below that trips a
  warning (partial download / fixture).
- **faa-sdr** downloads only missing/changed years; closed years are cached.
- **ntsb** api mode defaults to the first 100 registry tails if `--tails` is
  omitted; the live CAROL response shape should be spot-checked once (Step 3).
- **faa-ad** applicability from Federal Register prose is best-effort
  (`TEXT_MATCH`); for authoritative AD applicability, load a structured DRS
  export via `--offline` instead.

## Step 2b — load the offline/structured sources

These have no clean bulk API. Export from the source, then:

```sh
node bin/aerorisk.js ingest faa-enforcement --offline ./exports/enforcement --base ./data/ingest
node bin/aerorisk.js ingest asrs             --offline ./exports/asrs        --base ./data/ingest
node bin/aerorisk.js ingest runway-incursions --offline ./exports/asias      --base ./data/ingest
node bin/aerorisk.js ingest wildlife-strikes  --offline ./exports/wildlife    --base ./data/ingest
```

Expected CSV schemas are documented in `README.md` → "Data directory schemas".

## Step 3 — if a source reports SHAPE_MISMATCH or an ingest warns of unmapped columns

The message names the missing field(s) and prints the actual headers it saw.
Add the real header to the candidate list — a one-line change, no new logic:

- **SDR**: `src/ingest/adapters/faaSdr.js` → `FIELD_CANDIDATES`
- **NTSB CSV**: `src/ingest/adapters/ntsb.js` → `CSV_CANDIDATES`
- **NTSB API JSON**: `src/ingest/adapters/ntsb.js` → `JSON_CANDIDATES` (dot-paths)
- **Enforcement / ASRS / ASIAS / wildlife**: `FIELD_CANDIDATES` in each adapter
- **Registry zip link / SDR year links**: the discovery regex in
  `faaRegistry.js` / `faaSdr.js`

Re-run the single source. If a table's columns changed, promotion is blocked
with `SCHEMA_CHANGED`; review, then re-run with `--accept-schema-change`.

## Step 4 — score and produce output

```sh
# one aircraft
node bin/aerorisk.js report N789EF --data ./data/ingest/db/production

# the V1 batch target: many tails → scored records + coverage gate
node bin/aerorisk.js batch tails.txt --data ./data/ingest/db/production --out-dir ./out
cat ./out/report.md   # V1 gate: PASS when every submitted tail resolved + scored
```

## Step 5 — schedule (optional)

FAA registry refreshes daily ~23:30 Central. Nightly:

```
30 5 * * * cd /path/to/aerorisk && node bin/aerorisk.js ingest all --base ./data/ingest
```

Or via Docker (see `README.md` → Docker).

## Definition of done for the live run

- `aerorisk doctor` exits 0 (all network sources `REACHABLE_SHAPE_OK`).
- `ingest all` produces `OK`/`OK_WITH_WARNINGS` for every source, with a
  registry row count in the expected ~290k range.
- `batch` over ~100 real tails reports a `PASS` V1 gate with evidence links
  stored — i.e. 100 in → 100 resolved → enriched → scored, no manual exports.
