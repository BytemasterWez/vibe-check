# Methodology note — unemployment_spike_2pp_12m backtest

Generated 2026-07-12T15:37:30Z by the CountySignal Engine backtest harness. Every number below is reproducible from the source contracts, raw artifact hashes and ingestion runs recorded in the registry.

## Sources used
- **bls_laus** — BLS Local Area Unemployment Statistics (Bureau of Labor Statistics); licence public_government_data; lifecycle PRODUCTION_ALLOWED; latest period 2015-12-01; county join rate 1.0
- **census_acs** — Census American Community Survey 5-Year Estimates (U.S. Census Bureau); licence public_government_data; lifecycle PRODUCTION_ALLOWED; latest period 2023-01-01; county join rate 1.0
- **fema_nri** — FEMA National Risk Index (county) (Federal Emergency Management Agency); licence public_government_data; lifecycle PRODUCTION_ALLOWED; latest period 2023-03-01; county join rate 1.0

## County coverage
64 active county-equivalents in ref.counties participated. Sources below COUNTY_JOIN_PASSING are excluded from features and therefore from this backtest.

## Event definition
```yaml
event_id: unemployment_spike_2pp_12m
description: County unemployment rate increases by at least 2 percentage points over 12 months.
base_variable: bls_laus_unemployment_rate
condition:
  transform: change_12m
  operator: ">="
  threshold: 2.0
time_grain: month
minimum_history_months: 12
case_control:
  control_strategy: same_period_non_event
  exclusions:
    - reason: insufficient_history
    - reason: missing_base_variable
  max_controls_per_case: 10
```

## Case/control matching
- cases: first qualifying occurrence per county (10)
- controls: non-event counties sampled at case periods (100)
- excluded: 11 (missing condition feature or not sampled)
- control/case ratio: 10.0

## Windows
- training label periods: 2013-02-01..2013-09-01
- test label periods: 2014-04-01..2015-04-01
- prediction horizon: features observed 6 months before each label period (no future data; the event's own trigger feature is excluded from the design matrix)

## Features tested
17 features from contracts/features/default_features.yaml (lags, changes, rolling means, national/state z-scores and ranks, per-capita transforms).

## Models and baselines
- baseline: baseline_national_average — auc=0.5000, precision_at_100=0.0980, precision_at_50=0.1000, recall_at_100=1.0000, recall_at_50=1.0000
- baseline: baseline_previous_value — auc=0.8500, precision_at_100=0.0980, precision_at_50=0.1000, recall_at_100=1.0000, recall_at_50=1.0000
- model: logistic_regression — auc=0.9696, precision_at_100=0.0980, precision_at_50=0.1000, recall_at_100=1.0000, recall_at_50=1.0000
- model: random_forest — auc=0.8783, precision_at_100=0.0980, precision_at_50=0.1000, recall_at_100=1.0000, recall_at_50=1.0000

Best model: **logistic_regression**.

## Limitations
- Case counts depend on event threshold choice; rarity limits statistical power.
- Controls are sampled, not exhaustively matched on covariates.
- Annual/static variables enter monthly matrices as-of their vintage with a staleness cutoff; reporting lags apply.
- Scores are similarity-to-historical-conditions estimates, not causal claims.

## Provenance and freshness
Every observation used carries provenance to a hashed raw artifact (see /v1/provenance/{record_id}). Source freshness at run time is listed in the sources table above.
