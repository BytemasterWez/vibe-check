# Adding a new recipe

Recipes are the product layer: a config that names an event, selects
feature categories, and declares outputs. Recipes reuse the substrate —
normalised variables, features, event definitions, experiment machinery,
score tables, API views. **Do not build a recipe as its own codebase.**

## 1. Declare it

Create `contracts/recipes/<recipe_id>.yaml`:

```yaml
recipe_id: housing_stress_monitor
name: Housing Stress Monitor
description: Scores counties for similarity to historical housing pressure conditions.
event_id: housing_pressure_fmr_growth     # must exist under contracts/events/
features:
  include_categories: [housing, labour, demographics]
  exclude_features: []
model:
  type: logistic_regression
  compare_against: [baseline_national_average, baseline_previous_value]
outputs: [county_score, national_rank, state_rank, top_drivers, evidence_json]
api_exposed: true
```

## 2. Run it

```bash
python -m scripts.run_scoring --recipe housing_stress_monitor
```

This trains (or retrains) on the event's case/control set, scores every
county at the latest period, writes `score.county_scores` /
`score.county_rankings` with a new `score.score_versions` row, and exports
the evidence-backed scorecard CSV to `exports/`.

## 3. Consume it

- `GET /v1/scores/housing_stress_monitor` (+ `?format=csv`)
- `GET /v1/rankings/counties?recipe_id=housing_stress_monitor`
- Each score carries `top_positive_factors`, `top_negative_factors` and
  `evidence_json` with the exact feature values used — a recipe cannot
  claim a score whose supporting variables are missing from the store
  (missing-feature share is surfaced as `confidence` and listed in
  `evidence_json.missing_model_features`).

A recipe whose event's base variable comes from a source below
`COUNTY_JOIN_PASSING` simply finds no observations: the lifecycle gates
apply to recipes automatically.
