# Architecture, Autonomy Model & Operating Loop (Phases 5, 5B, 6, 8C)

## High-level architecture

```
┌────────────────────── worker container (daily) ──────────────────────┐
│ connectors (CF, FTS) → raw_releases → normalise → validate ─┬→ notices│
│        retry/backoff · cursor paging · hash dedupe          └→ quarantine
│ then: scoring engine (deterministic) → scores                        │
│ then: digest/report generation (+optional capped LLM summary)        │
└──────────────────────────────┬────────────────────────────────────────┘
                        SQLite/Postgres (volume)
┌──────────────────────────────┴────────────────────────────────────────┐
│ api container (FastAPI): /health /notices /profiles /matches/{id}     │
│ /matches/{id}/export.csv  +  HTML dashboard at /                      │
└────────────────────────────────────────────────────────────────────────┘
```

Stack: Python 3.11, FastAPI, SQLAlchemy 2, SQLite (→ Postgres via
`DATABASE_URL` when concurrency demands it), Docker Compose, no Redis, no
queue — deliberate minimalism per the operating rules. PostGIS not needed
(regions are categorical, not geometric).

## Autonomy permission model (Phase 5B)

**Autonomous, no approval:** source health checks; fetching both public APIs;
parsing/normalising/validating; quarantining bad rows; scoring; digest and
CSV generation; dashboard refresh; retries with backoff; run logging.

**Requires human approval:** sending any outreach email (digests are
*generated*, never auto-sent to prospects); charging customers; deleting
production data; adding a new source (licence review first); enabling or
raising the LLM cost cap; any scraping (none currently — APIs only); public
posting; contacting buyers.

**Controls implemented:** audit trail = `ingest_runs` + `raw_releases`
(replayable); kill switch = `docker compose stop worker` (API keeps serving
last-known-good data); LLM cost cap enforced in code
(`app/utils/llm.py`, ledger in `data/llm_spend.json`, default $5/month);
manual override = every pipeline stage runnable ad hoc via CLI; safe mode =
source failure marks the run `source_unavailable` and leaves canonical data
untouched.

## Autonomous operating loop (Phase 6)

Daily (worker container): ingest CF + FTS for the last day (window overlap +
idempotent upserts make missed days self-healing — rerun with
`--since-days N`) → rescore all profiles → write digest files. `/health`
answers: last run status per source, freshness, notice/quarantine counts.

The system can answer the mandated questions: *what changed* (inserted/
updated counts per run), *why it matters* (score + reasons per notice), *who
cares* (profile), *evidence* (source_url + ocid on every line), *freshness*
(run timestamps), *confidence* ("unknown, not penalised" reasons), *what
failed* (run.error, quarantine reasons).

Weekly manual (10 min): skim quarantine, check drift test in CI, review
digest quality for each paying customer.

## Model availability / offline mode / LLM cost (Phase 8C)

| Task | Mechanism |
|---|---|
| Parsing, validation, dedupe, dates, joins | **Deterministic code — LLM prohibited** |
| Scoring & explanations | **Deterministic rules** — reasons are generated from the same predicates that award points, so explanations cannot hallucinate |
| Digest prose summary | *Optional* LLM (OpenRouter-compatible, default `deepseek/deepseek-chat`) |

Fallback: no key / API error / cap reached → digest ships without the summary
paragraph; nothing else changes. Cost: ~$0.002/digest estimate, hard monthly
cap $5 (configurable), ledger persisted. At 1/5/10/25/50/100 customers with
daily digests: ≈ $0.06/$0.30/$0.60/$1.50/$3/$6 per month — rounding error
against price. LLM output is stored in the digest file (auditable) and is
constrained by prompt to facts present in the digest; every underlying claim
carries its own deterministic evidence line. **The product is fully offline-
capable except for the two source APIs themselves.**
