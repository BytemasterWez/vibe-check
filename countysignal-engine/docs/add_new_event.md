# Adding a new event

Events are configuration. If you are writing Python to add an event, stop.

## 1. Declare it

Create `contracts/events/<event_id>.yaml`:

```yaml
event_id: branch_density_decline
description: County bank branch count falls at least 10% over 36 months.
base_variable: fdic_branch_count          # must exist in the variable dictionary
condition:
  transform: pct_change_36m               # any transform the feature engine knows
  operator: "<="
  threshold: -10.0
time_grain: year
minimum_history_months: 36
case_control:
  control_strategy: same_period_non_event
  max_controls_per_case: 10
```

## 2. Make sure the condition feature exists

The event engine evaluates the feature
`{base_variable}__{condition.transform}`. Add that transform for the base
variable in `contracts/features/default_features.yaml` if it is not
already produced.

## 3. Run it

```bash
python -m scripts.run_event --event branch_density_decline
python -m scripts.run_experiment --event branch_density_decline
```

The event engine produces occurrences, cases (first occurrence per
county), eligible controls, and exclusions with reasons — all persisted to
`event.*` with the config hash, so occurrences are always traceable to the
exact definition version.

Constraints enforced for you:
- `minimum_history_months` — counties without enough base-variable history
  can never trigger.
- The condition feature is **excluded** from experiment design matrices
  (it defines the label; keeping it would leak).
- Experiments over the event automatically compare against naive baselines.
