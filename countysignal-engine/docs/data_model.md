# Data model

Thirteen schemas, one direction of flow. Nothing downstream ever reaches
back upstream, and the API sees only the last layer.

`registry → raw → src → (stg) → norm → feature → event → experiment → score → api`
with `audit` and `quarantine` written from every stage, and `ref` joined
from normalisation onward.

## registry — source contracts and runs
- `registry.sources` — one row per source contract; carries the verbatim
  contract YAML, its hash, and the lifecycle `status`.
- `registry.source_versions` — contract-hash history (`source_version`
  everywhere else is the 12-char hash prefix).
- `registry.source_fields` — declared field inventory.
- `registry.ingestion_runs` — one row per pipeline run (mode, counts, error).
- `registry.source_health` — rollup consumed by `/v1/source-health`.
- `registry.licence_terms` — licence status, attribution text, review notes.

## ref — canonical geography
- `ref.counties` — **the master geography table.** Everything county-level
  joins to it on `county_fips` (5-char). Portable `centroid_lat/lon`; PostGIS
  `geometry`/`centroid` columns exist when the extension is installed.
- `ref.states`, `ref.geography_aliases` (curated alternate names),
  `ref.fips_crosswalks` (official FIPS changes: Shannon→Oglala Lakota,
  Bedford city→county, CT county→planning-region recodes), `ref.naics`,
  `ref.source_categories`.

### Canonical county count

**The canonical count is 3,144 county-equivalents** (50 states + DC,
2023 Census vintage), and here is why it is not 3,143:

- The 2020 Census counted **3,143** counties and county-equivalents in the
  50 states + DC.
- In 2022 Connecticut replaced its 8 legacy counties with **9 planning
  regions** as county-equivalents (approved by the Census Bureau, effective
  in data products from 2022–2023). Net +1 → **3,144**.
- Territories (PR, GU, VI, AS, MP) add ~90 more county-equivalents. They are
  **excluded from the canonical set** (`ref.states.is_state=false` rows exist
  only for DC) but the schema supports them if a future recipe needs them —
  add the state rows and county rows; nothing else changes.
- Historical changes are represented in `ref.fips_crosswalks`, and
  `valid_from`/`valid_to`/`is_active` on `ref.counties` support future
  boundary changes without rewriting history.

The seeded count is asserted after `scripts/seed_ref.py`; running on the
bundled fixture (64 counties) prints an explicit warning.

## raw — immutable artifacts
`raw.files`, `raw.api_payloads`, `raw.extract_manifests`. Every artifact:
source URL, request params, object-store key, **sha256 content hash**
(unique per source — identical bytes are never stored twice), claimed vs
loaded record counts, licence status. Rows are never updated or deleted.

## src — source-native parsed rows
One table per source (`src.bls_laus`, `src.census_acs`, `src.fema_nri`, …).
Source field names are kept; every table carries the mandatory provenance
columns: `source_id, source_version, ingestion_run_id, raw_artifact_id,
retrieved_at, source_record_id, source_row_hash` with a uniqueness
constraint over (source_id, source_record_id, source_row_hash) — this is
what makes re-ingestion idempotent.

## stg — scratch
Transient staging (e.g. DuckDB spills); no contracts, may be truncated.

## norm — canonical county-time observations
- `norm.variable_dictionary` — every variable is registered before any
  observation may reference it (unit, grain, directionality,
  higher_is_good, missing-value policy…).
- `norm.county_month_variables` / `norm.county_year_variables` /
  `norm.county_static_variables` — long/EAV facts keyed by
  (county_fips, period, variable_id, source_id, source_version), each row
  carrying `confidence` (join method) and `provenance_json`.
  A `CHECK` constraint restricts `confidence` to the five authoritative
  join methods — fuzzy candidates physically cannot land here.
- `norm.county_observations` — view unioning the three grains.

## feature — matrices
`feature.feature_definitions` (from config), `feature.feature_runs`
(with as-of cutoff for leakage control), `feature.feature_matrix` (long:
county, period, feature, value), `feature.feature_quality` (coverage,
null rate, distribution stats per feature/period).

## event / experiment / score
- `event.definitions` mirror the YAML contracts (with config hash);
  `event.occurrences`; `event.case_control_sets` (members + diagnostics).
- `experiment.runs`, `experiment.models` (baselines flagged),
  `experiment.metrics` (AUC, precision@k, recall@k), 
  `experiment.variable_rankings`, `experiment.case_control_diagnostics`
  (leakage/baseline checks persisted per run).
- `score.score_versions` (recipe × experiment × model), 
  `score.county_scores` (score, national/state rank, confidence, top
  positive/negative factors, `evidence_json` with the exact feature values
  used), `score.county_rankings`, `score.score_explanations`.

## api — the only exposed surface
`api.county_profile`, `api.county_signal_pack`, `api.county_scores`,
`api.county_rankings`, `api.event_scorecards`, `api.events`,
`api.experiments`, `api.experiment_top_variables`, `api.source_health`,
`api.provenance`, `api.variable_dictionary`. The read-only role sees these
views only. Changing a view's shape is a versioned migration.

## audit / quarantine
- `audit.jobs`, `audit.validation_results` (five levels),
  `audit.schema_drift`, `audit.row_count_checks`, `audit.join_quality`,
  `audit.api_usage`, `audit.errors`.
- `quarantine.records` (stage + reason + full record),
  `quarantine.join_candidates` (fuzzy joins awaiting review:
  pending/approved/rejected), `quarantine.validation_failures`.
