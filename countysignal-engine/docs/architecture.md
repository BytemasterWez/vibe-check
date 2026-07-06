# Architecture

CountySignal Engine is a **substrate**: ingest → normalise → feature →
event → experiment → score → API. Product recipes are configs over the
substrate, never separate codebases.

## Services (docker-compose)

| Service | Role |
|---|---|
| `postgres-postgis` | System of record. 13 schemas (see [data_model.md](data_model.md)). PostGIS for geometry when present; the engine also runs on plain Postgres (portable centroid lat/lon columns). |
| `api` | FastAPI. Reads **only** `api.*` views via the read-only role. |
| `worker` | Executes queued jobs (`cse:jobs` Redis list): ingest / features / event / experiment / scoring. |
| `scheduler` | Enqueues ingestion per each contract's `update_frequency`, plus a daily feature/event/scoring refresh. All schedules derive from contracts. |
| `validator` | Periodic data-quality sweeps (missingness, unit consistency, freshness, duplicates) into `audit.validation_results`. |
| `redis` | Job queue, rate-limit state, cache. |
| `object-storage` | MinIO/S3 for immutable raw artifacts (content-addressed). |
| `docs` | MkDocs site for this documentation. |

## Data flow

```
contracts/sources/*.yaml ──► adapters (fetch/parse/validate/src-map)
        │                            │
        ▼                            ▼
registry.* (contracts, runs)   raw.* (immutable bytes + sha256)
                                     │ parse
                                     ▼
                               src.* (source-native rows + provenance cols)
                                     │ county join hierarchy
                          ┌──────────┴──────────┐
                          ▼                     ▼
                    norm.* (county-time    quarantine.* (fuzzy joins,
                    observations, EAV)     failures — nothing dropped)
                          │
                          ▼ feature config (contracts/features)
                    feature.feature_matrix
                          │
              ┌───────────┼─────────────┐
              ▼           ▼             ▼
        event.* (config-  experiment.*  score.* (recipes over
        declared events)  (case/control, experiment models)
                          baselines, AUC)
                          │
                          ▼
                    api.* views ──► FastAPI ──► clients / CSV export
```

## Where the design rules are enforced

The non-negotiable rules live in code, not in convention:

| Rule | Enforcement point |
|---|---|
| No scraping without explicit permission | `SourceContract` validator rejects scraping access methods (`engine/contracts.py`) |
| Contract before ingestion | Adapters cannot be constructed without a contract (`adapters/base.py`, `adapters/registry.py`) |
| Raw stored before transformation | `run_source_pipeline` stores + hashes the artifact before `parse()` is ever called (`engine/ingestion/runner.py`) |
| Provenance on every row | `src.*` provenance columns are mandatory; `norm.*` rows carry `provenance_json`; built centrally in `engine/provenance` |
| Failures → quarantine | Runner + normaliser route all failures to `quarantine.*`; nothing is silently dropped |
| Explicit, auditable county join | `engine/normalisation/geography.py` — ordered hierarchy, method recorded per row, `audit.join_quality` per run |
| Fuzzy joins never authoritative | `MATCH_CANDIDATE_FUZZY` is excluded from `AUTHORITATIVE_METHODS`; DB `CHECK` constraints on `norm.*` reject it outright |
| No norm writes before `VALIDATION_PASSING` | Gate in `run_source_pipeline`; status promoted only by observed evidence |
| No score impact before `COUNTY_JOIN_PASSING` | `load_observations(scoring_only=True)` filters sources by lifecycle status (`engine/orchestration.py`) |
| No raw table exposure | API reads via `countysignal_api_ro`, which is granted `SELECT` on `api.*` only (migration `0013`) |
| Outputs rebuildable | Contract YAML + hash stored in `registry.sources`; every observation links run → artifact → content hash |
| No Louisiana hard-coding | No state-specific code paths exist; Louisiana counties appear only in seeds/fixtures as validation data |

## Migrations

Plain ordered SQL under `db/migrations/`, applied by `scripts/migrate.py`,
recorded with content hashes in `public.schema_migrations` (a changed,
already-applied file fails the run — write a new migration instead).
Alembic can be layered on later without changing the SQL files; the runner
was chosen because every schema object is reviewable as literal SQL.

## LLM policy

LLMs may assist classification and explanation (e.g. drafting alias
candidates, describing score drivers) but are never the source of truth:
nothing an LLM produces may enter `ref.*`, `norm.*` or `score.*` without
passing the same contracts, joins and validation as any other input.
