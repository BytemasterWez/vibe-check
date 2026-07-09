# Canonical Schema & Field Mapping

Tables are defined in `app/models.py`; transformations in
`app/normalisation/normalise.py`. Layers: **raw** (verbatim OCDS payloads,
hash-deduplicated) → **canonical** (`notices`, one row per OCID) →
**derived** (`scores`).

## `notices` — canonical field mapping

| Canonical field | CF source path | FTS source path | Type | Transform / null handling |
|---|---|---|---|---|
| `source_name` | constant | constant | str | — |
| `source_url` | `tender.documents[type=tenderNotice].url` | `https://www.find-tender.service.gov.uk/Notice/{id}` | str | fallback: any doc URL / "" |
| `ocid` | `ocid` | `ocid` | str | **unique key**; must start `ocds-` else quarantine |
| `release_id` | `id` | `id` | str | — |
| `notice_type` | `tag[0]` | `tag[0]` | str | "" if absent |
| `status` | `tender.status` | same | str | whitespace-collapsed |
| `title` | `tender.title` | same | str | **required** else quarantine; whitespace-collapsed |
| `description` | `tender.description` | same | str | `\r\n` collapsed |
| `buyer_name` / `buyer_id` | `buyer.name/.id` | same | str | fallback: first party with role `buyer`; "" if none |
| `cpv_codes` / `cpv_descriptions` | `tender.classification` + `additionalClassifications[]` | same | json list | main first, dedup, stringified |
| `procurement_category` | `tender.mainProcurementCategory` | same | str | works/services/goods |
| `value_amount/_min/_max`, `value_currency` | `tender.value/minValue/maxValue` | same | float/str | commas/£ stripped; midpoint of min/max when amount absent; NULL preserved |
| `published_date` | `tender.datePublished` → `date` | same | datetime | ISO parse, `+01:00`/`Z`/date-only handled, stored naive UTC; NULL on unparseable |
| `deadline_date` | `tender.tenderPeriod.endDate` | same | datetime | as above |
| `contract_start/_end` | `tender.contractPeriod` | same | datetime | as above |
| `regions` | `tender.items[].deliveryAddresses[].region` | same + buyer party `address.region` (ITL code) | json list | deduped, sorted; may mix names & ITL codes — scoring does substring match |
| `sme_suitable` / `vcse_suitable` | `tender.suitability.sme/.vcse` | same | bool? | tri-state NULL = unknown (never guessed) |
| `raw_payload_hash` | whole release | whole release | str | sha256 of sorted JSON — change detection |
| `ingested_at` / `updated_at` | system | system | datetime | freshness display |

## Normalisation rules

- **Dates:** ISO 8601 with offsets → naive UTC. Date-only kept at midnight.
  Unparseable → NULL (validators then decide, never a crash).
- **Text:** all whitespace runs collapsed to single spaces; no case-folding of
  display fields (casing preserved for buyer-facing output).
- **Money:** float; commas and `£` stripped; currency carried separately.
- **Dedup keys:** raw layer `sha256(payload)`; canonical layer `ocid`
  (newest differing release wins via upsert).
- **Invalid records:** quarantined with joined reason strings; never dropped,
  never auto-corrected.
- **Confidence:** unknown value/region score partial credit (+5 not +10) and
  say so in the reasons list — absence of data is surfaced, not hidden.

## Other tables

- **`raw_releases`** — audit/replay layer: source, ocid, verbatim JSON, hash
  (unique), fetched_at.
- **`profiles`** — matching spec: keywords[], cpv_prefixes[], regions[],
  value band, require_sme, min_days_to_deadline.
- **`scores`** — (notice, profile) unique; 0–100 int + `reasons` json — the
  explainability record shown verbatim to buyers.
- **`ingest_runs`** — per-run counts + status + error: powers freshness and
  health reporting.
- **`quarantine`** — failed records with reason and full payload.
