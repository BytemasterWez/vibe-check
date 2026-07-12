# CountySignal Engine

*Internal name: OpenClaw County Substrate*

**This is a product-agnostic national county signal substrate.** It ingests
public datasets safely, normalises them to U.S. county geography, joins them
through stable identifiers (county FIPS), computes feature matrices, defines
events, runs scoring experiments, and exposes results through a stable API.

Four things to understand before touching anything:

1. **Product recipes are implemented over the substrate.** Labour shock
   monitoring, housing stress scoring, lending gap detection, disaster
   recovery demand — all of these are *configs* (`contracts/recipes/`) over
   the same normalised signal store. None of them is a special-case system.
2. **Louisiana is a validation geography, not the core product.** The engine
   works nationally across all U.S. counties and county-equivalents. There is
   no Louisiana-specific code path in the core engine.
3. **No source may enter scoring until it passes source, schema, geography
   and provenance validation.** Source status is a gated lifecycle
   (`UNVERIFIED → … → PRODUCTION_ALLOWED`); a source cannot write to `norm.*`
   before `VALIDATION_PASSING` and cannot affect scores before
   `COUNTY_JOIN_PASSING`.
4. **Every output is rebuildable** from source contracts, raw artifacts, and
   ingestion logs. Every row carries provenance.

## The lifecycle

```
Add source contract (contracts/sources/*.yaml)
  → run ingestion            (raw artifact stored, hashed, provenance recorded)
  → validate schema & geography
  → normalise to county-time variables   (norm.county_month_variables, …)
  → add variables to dictionary          (norm.variable_dictionary)
  → generate feature matrix              (feature.feature_matrix)
  → define event                         (contracts/events/*.yaml)
  → run experiment                       (experiment.runs, ranked variables)
  → score counties                       (score.county_scores)
  → expose API endpoint                  (api.* views → FastAPI)
  → export evidence-backed scorecard     (CSV)
```

## Quick start

```bash
cp .env.example .env          # fill in secrets
docker compose up -d          # postgres-postgis, redis, minio, api, worker, scheduler, validator, docs
docker compose exec api python -m scripts.migrate        # apply migrations
docker compose exec api python -m scripts.seed_ref       # seed ref.states + ref.counties
docker compose exec api python -m scripts.run_pipeline --source bls_laus --mode sample
curl -H "X-API-Key: $CSE_API_KEY" localhost:8000/health
```

Without Docker (development):

```bash
pip install -e ".[dev]"
pytest tests/unit             # no database required
```

## Repository layout

| Path | Purpose |
|---|---|
| `contracts/` | Machine-readable source, variable, event and recipe contracts (YAML) |
| `db/` | Migrations (SQL, per schema), seeds, API views |
| `adapters/` | One ingestion adapter package per upstream provider |
| `engine/` | Ingestion, normalisation, features, events, experiments, scoring, exports, provenance |
| `services/` | FastAPI API, worker, scheduler, validator entrypoints |
| `tests/` | Unit tests (no DB) and integration tests (require Postgres) |
| `docs/` | Architecture, data model, how-to guides, compliance |

## Canonical geography

`ref.counties` is the master geography table. The canonical count is
**3,144 county-equivalents** (50 states + DC, 2023 vintage). See
[docs/data_model.md](docs/data_model.md#canonical-county-count) for the full
reasoning (Connecticut planning regions, territories, historical changes).

## Milestone status

- **Milestone 1** (this codebase): BLS LAUS, Census ACS, FEMA NRI end-to-end;
  `unemployment_spike_2pp_12m` event; experiment engine; scorecard CSV export;
  county profile / signal-pack / score / provenance / source-health endpoints.
- **Milestone 2**: QCEW, CBP, SAIPE, HUD FMR, FHFA HPI, BEA — add via new
  contracts + adapters, no engine changes.
- **Milestone 3**: HMDA, FDIC, SBA, IRS migration, USAspending, FEMA
  declarations, drought/climate/NASS/permits/Zillow/SVI + product recipes.

## Documentation

- [docs/architecture.md](docs/architecture.md) — services, data flow, design rules
- [docs/data_model.md](docs/data_model.md) — every schema and table
- [docs/source_contracts.md](docs/source_contracts.md) — contract format & lifecycle
- [docs/add_new_source.md](docs/add_new_source.md) — how to add a source
- [docs/add_new_event.md](docs/add_new_event.md) — how to add an event
- [docs/add_new_recipe.md](docs/add_new_recipe.md) — how to add a recipe
- [docs/api.md](docs/api.md) — endpoint reference
- [docs/validation.md](docs/validation.md) — the five validation levels
- [docs/backtest.md](docs/backtest.md) — historical event backtests
- [docs/compliance.md](docs/compliance.md) — licensing, scraping policy, attribution
- [docs/deployment.md](docs/deployment.md) — Docker Compose & cloud deployment
