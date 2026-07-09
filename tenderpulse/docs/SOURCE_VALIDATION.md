# Source Validation & Ingestion-Readiness Proof (Phases 3, 3B, 3C)

All tests below were executed **live on 2026-07-09** from the build
environment. Nothing here is assumed; commands are reproducible.

## Source 1 — Contracts Finder (below-threshold UK notices)

| Property | Finding |
|---|---|
| Owner | UK Cabinet Office / Crown Commercial Service |
| Access URL | `https://www.contractsfinder.service.gov.uk/Published/Notices/OCDS/Search` |
| Auth | **None** |
| Format | JSON, OCDS 1.1 release packages |
| Licence | Open Government Licence v3 (in every response payload) |
| Pagination | Cursor via `links.next` (server-issued URL) |
| Filters | `publishedFrom`/`publishedTo` (ISO local, no zone suffix), `stages` (tender/award/planning), `limit` ≤100 |
| Update frequency | Continuous (notices published daily incl. weekends) |
| Historical depth | Years of history via date windows |
| Coverage | England-focused; below-threshold contracts (~£12k+) |
| Rate limits | None documented; polite paging + retry/backoff implemented |
| Backup source | Find a Tender covers above-threshold; data.gov.uk bulk OCDS dumps exist for CF history |

### Raw access proof (executed)

```
curl "https://www.contractsfinder.service.gov.uk/Published/Notices/OCDS/Search?publishedFrom=2026-07-07T00:00:00&publishedTo=2026-07-08T00:00:00&stages=tender&limit=10"
→ HTTP 200 | application/json | 46,552 bytes | 10 releases
```

Sample release (abridged, real):

```json
{"ocid": "ocds-b5fd17-5c27e2d5-...", "tag": ["tender"],
 "tender": {"id": "MT237685",
   "title": "Filming - The Special Qualities of the North York Moors",
   "status": "active",
   "classification": {"scheme": "CPV", "id": "79340000"},
   "tenderPeriod": {"endDate": "2026-07-20T17:00:00+01:00"},
   "suitability": {"sme": true, "vcse": false},
   "items": [{"deliveryAddresses": [{"region": "North East", ...}]}]}}
```

### Error / edge behaviour (executed)

- Empty date range (future window) → HTTP 200, valid package, zero releases. ✅
- Invalid parameter (`publishedFrom=notadate`) → HTTP 400 with structured
  JSON `{"code": 3200, "message": "Incorrect request [invalid date]", "property": "publishedFrom"}`. ✅
- Cursor page 2 fetched → HTTP 200, 10 distinct releases (first OCID differs
  from page 1). ✅

## Source 2 — Find a Tender (above-threshold UK notices)

| Property | Finding |
|---|---|
| Owner | UK Cabinet Office |
| Access URL | `https://www.find-tender.service.gov.uk/api/1.0/ocdsReleasePackages` |
| Auth | **None** |
| Format | JSON, OCDS 1.1 (richer: parties with PPON IDs, addresses, contact points, awards, contracts) |
| Licence | Open Government Licence v3 |
| Pagination | Cursor via `links.next` |
| Filters | `updatedFrom`/`updatedTo`, `stages`, `limit` |
| Coverage | UK-wide, above-threshold (higher-value) procurements |
| Backup source | Contracts Finder (complementary threshold band); OCDS bulk downloads |

### Raw access proof (executed)

```
curl "https://www.find-tender.service.gov.uk/api/1.0/ocdsReleasePackages?limit=10"
→ HTTP 200 | application/json | 167,504 bytes | 10 releases

curl ".../ocdsReleasePackages?updatedFrom=2026-07-08T00:00:00&updatedTo=2026-07-09T00:00:00&stages=tender&limit=3"
→ HTTP 200 | 3 releases | tender.value = {"amount": 5000000, "currency": "GBP"} present
```

## Schema inspection (both sources)

Observed field inventory (from live payloads): `ocid`, `id`, `date`, `tag[]`,
`initiationType`, `buyer{name,id}`, `parties[]{name,id,identifier,address{region,postalCode,country},roles[],details}`,
`tender{id,title,description,status,classification{scheme,id,description},additionalClassifications[],items[]{deliveryAddresses[]},procurementMethod,tenderPeriod{endDate},contractPeriod{startDate,endDate},suitability{sme,vcse},mainProcurementCategory,documents[],value{amount,currency},minValue,maxValue}`.

Variability observed and handled: CF uses `deliveryAddresses[]` with region
names ("Yorkshire and the Humber"); FTS uses ITL codes ("UKI53") in party
addresses. `value` sometimes absent on CF (min/max instead). `buyer` block
occasionally absent (fallback: party with role `buyer`). Dates carry `+01:00`,
`Z`, or are date-only.

## Processing & normalisation proof (Phase 3C — executed)

The proof-of-concept pipeline in this repo was run against **live production
data** on 2026-07-09:

```
python3 -m app.workers.ingest --source all --since-days 1 --max-pages 3
contracts_finder: ok seen=12 inserted=11 updated=1 quarantined=0
find_a_tender:    ok seen=8  inserted=8  updated=0 quarantined=0
```

- Retrieve ✅ Parse ✅ Normalise ✅ Bad-row detection ✅ (quarantine table,
  exercised in tests) Store ✅ (raw + canonical layers) Repeatable update ✅
  (rerun produced 0 duplicates; 1 re-published release correctly *updated*)
  Join-ready ✅ (both sources land in one canonical table keyed by OCID)
  Useful output ✅ (scored digest generated from live data — see README).

## Join-readiness

Both sources share the OCDS `ocid` as primary key (globally unique, prefix
`ocds-b5fd17-` CF / `ocds-h6vhtk-` FTS — no cross-source collisions, no fuzzy
matching needed). CPV codes join to the EU CPV taxonomy. Buyer names join
across notices exactly in most cases; future award-intelligence work will
need fuzzy supplier matching (flagged as the known hard part of product #2,
not needed for the MVP). Expected match rates: OCID dedupe 100% (exact);
buyer-name self-join ~90% exact, remainder needs normalisation.

## Quality checks implemented

Duplicate detection (payload hash + OCID upsert) · required-field validation ·
OCID format check · date plausibility bounds (2000 → +15y) · future-published
check · negative-value check · quarantine with explicit reasons · run audit
trail (seen/inserted/updated/quarantined per run) · schema-drift guard test in
CI (`test_schema_drift_guard_expected_fields_present`).

## Source verdicts

| Source | Access | Ingestion | Normalisation | Join-ready | Automation | Commercial reliability |
|---|---|---|---|---|---|---|
| Contracts Finder | **PASS** | **PASS** | **PASS** | **PASS** | HIGH | HIGH — official gov API, OGL licence, structured errors |
| Find a Tender | **PASS** | **PASS** | **PASS** | **PASS** | HIGH | HIGH — official gov API, OGL licence |

Failure modes & mitigations: temporary outage → retry w/ exponential backoff,
run marked `source_unavailable`, yesterday's data remains served; schema drift
→ drift test + quarantine catches it without corrupting the canonical layer;
policy change → both sources are statutory publication channels (Procurement
Act 2023), so discontinuation risk is minimal.
