# Validation

Five levels, all persisted to `audit.validation_results` with
observed/expected payloads. `severity: error` failures block; `warning`
failures record and continue.

## 1. Source (per ingestion run — `engine/validation.py::validate_source_batch`)
- access works (fetch succeeded; dry-run mode exists for access checks)
- schema matches contract (`field_map` vs observed fields; drift recorded
  in `audit.schema_drift`)
- required fields exist; row count plausible (`audit.row_count_checks`,
  claimed vs loaded)
- date fields parse; numeric fields parse; values within contract bounds
- raw artifact stored + hashed before any of this; source version recorded

A failing source run quarantines the batch summary and marks
`registry.source_health` failed. The source cannot proceed to `norm.*`.

## 2. Geography (per run — `validate_geography` + join hierarchy)
- county FIPS validity of everything that joined
- authoritative county join rate (≥95% required for `COUNTY_JOIN_PASSING`)
- distinct-county coverage vs contract minimum
- duplicate county-periods (validator sweep)
- unexpected territories are structurally impossible (they don't exist in
  `ref.counties`, so they land in quarantine as `no_county_match`)
- per-run breakdown by join method in `audit.join_quality`

## 3. Variable (validator service sweep — `validate_variables`)
- unit consistency per variable
- missingness thresholds
- freshness per source (updates `registry.source_health.freshness_days`)
- period continuity / outliers: distribution stats land in
  `feature.feature_quality`; bounds checks run at source level

## 4. Feature (per feature run — `validate_features`)
- every produced feature was declared in config (no undeclared features)
- lags computed correctly (unit-tested: exact period-offset joins so gaps
  can't misalign a lag)
- rolling windows require full windows (`min_periods=window`)
- z-scores guarded against zero/NaN stddev
- no future data: transforms only look backward; `matrix_as_of` takes the
  latest value at-or-before the target period with a staleness cutoff

## 5. Experiment (per experiment — `validate_experiment`)
- case count ≥ 5; controls ≥ cases
- time-based train/test split (no shuffling across periods)
- baseline comparison always present
- trigger feature excluded from the design matrix (label leakage)
- features strictly precede labels (prediction horizon > 0)
- AUC computed; diagnostics persisted to
  `experiment.case_control_diagnostics`

## Quarantine, not deletion

Any record failing parse/validate/join goes to `quarantine.records` (with
stage, reason and the full record) or `quarantine.join_candidates` (fuzzy
joins with candidate + score, awaiting review). Approving a fuzzy candidate
means adding a curated row to `ref.geography_aliases` and re-running —
which upgrades the join to the deterministic `MATCH_ALIAS` path.
