# Source contracts

A source contract is a machine-readable YAML file under
`contracts/sources/` that fully describes how a source is accessed,
licensed, parsed, validated, and normalised. **No contract, no ingestion**:
adapters cannot be constructed without one, and every run records the
contract hash so any output can be traced to the exact contract version
that produced it.

## Format

See `contracts/sources/bls_laus.yaml` for a complete example. Fields:

| Field | Meaning |
|---|---|
| `source_id` | Stable identifier; matches the adapter and `src.*` table |
| `name`, `owner`, `category` | Human metadata; `category` keys recipe feature selection |
| `access_method` | `official_api`, `official_download`, `bulk_file`, `open_data_portal`. Scraping methods are rejected unless `scraping_allowed: true` |
| `access_url` / `download_url` | Documentation page / concrete fetch URL (may contain `{year}`-style templates) |
| `licence_status`, `attribution` | Licensing posture + required attribution text |
| `api_key_required` | Whether an upstream key is needed (never stored in the contract — env vars only) |
| `update_frequency` | Drives the scheduler (`monthly`, `annual`, …) |
| `geography_level`, `time_grain`, `canonical_join_key` | Must be county / county-joinable |
| `raw_format`, `src_table` | Artifact format and destination `src.*` table |
| `field_map` | Source column → src column mapping; also powers schema-drift detection |
| `variables` | Bindings from source fields to registered `variable_id`s |
| `validation` | Coverage minimums, numeric fields, bounds, time-parse requirements |
| `provenance_required` | Always `true`; kept explicit deliberately |
| `production_allowed` | Permission **ceiling** — whether this source may ever reach `PRODUCTION_ALLOWED` |
| `status` | Starting lifecycle status (typically `DOCS_CONFIRMED` after human review) |

## Lifecycle

```
UNVERIFIED → DOCS_CONFIRMED → ACCESS_CONFIRMED → SAMPLE_CAPTURED
    → SCHEMA_MAPPED → VALIDATION_PASSING → COUNTY_JOIN_PASSING
    → PRODUCTION_ALLOWED            (DISABLED from anywhere)
```

Statuses are **promoted by evidence, not declared**:

- The contract's `status` field only sets the starting point (and `DISABLED`
  always wins). Re-reading a contract never promotes or demotes a source —
  see `upsert_source` in `engine/ingestion/sink.py`.
- `SAMPLE_CAPTURED`: a raw artifact was stored and hashed.
- `VALIDATION_PASSING`: source-level validation passed on a real batch
  (implies the schema mapped — the schema check is part of validation).
- `COUNTY_JOIN_PASSING`: authoritative county join rate ≥ 95% with
  geography validation passing.
- `PRODUCTION_ALLOWED`: reached `COUNTY_JOIN_PASSING` **and** the contract
  carries `production_allowed: true`.

Two hard gates hang off the lifecycle:

1. **A source below `VALIDATION_PASSING` cannot write to `norm.*`** — the
   runner stops after `src.*` and marks the run `partial`.
2. **A source below `COUNTY_JOIN_PASSING` cannot affect scores** — 
   `load_observations(scoring_only=True)` excludes it from feature
   matrices, so events, experiments and scores never see it.

## Versioning

`source_version` is the first 12 chars of the contract's sha256. Every raw
artifact, src row and normalised observation carries it, so changing a
contract automatically partitions downstream data by contract version.
