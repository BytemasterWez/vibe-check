# TenderPulse

**Scored, explained UK public-tender alerts for SME niches.** Ingests both
official UK procurement feeds — Contracts Finder (below-threshold) and Find a
Tender (above-threshold) — daily, normalises them into one canonical schema,
deduplicates, scores every open tender against client profiles with
human-readable reasons, and produces digests, CSV exports, and a dashboard.

Built by an autonomous product-builder run on 2026-07-09. Both data sources
were **live-verified during the build** and the pipeline was proven against
production data (20 real notices ingested, scored, and reported).

## Quick start

```bash
cd tenderpulse
pip install -r requirements.txt
python -m pytest tests/ -q                 # 40 tests
python -m app.workers.ingest --source all --since-days 1   # live ingest
uvicorn app.api.main:app --port 8000       # dashboard at http://localhost:8000
```

Or with Docker (API + daily worker):

```bash
cp .env.example .env && docker compose up -d --build
```

Create a profile and get a digest:

```bash
curl -X POST localhost:8000/profiles -H 'content-type: application/json' \
  -d '{"name":"IT SME","keywords":["software","digital"],"cpv_prefixes":["72","48"],"min_value":10000,"max_value":2000000}'
curl localhost:8000/matches/1              # markdown digest with evidence
curl localhost:8000/matches/1/export.csv   # CSV export
```

## Layout

```
app/connectors/      Contracts Finder + Find a Tender OCDS clients (cursor paging, retry)
app/normalisation/   OCDS release → canonical record (deterministic)
app/validation/      required fields, plausibility checks → quarantine
app/scoring/         explainable 0–100 profile matching (no LLM in the data path)
app/reports/         markdown digests + CSV export (optional capped LLM summary)
app/api/             FastAPI: /health /notices /profiles /matches + dashboard
app/workers/         ingestion pipeline + CLI
tests/               40 tests incl. end-to-end on real captured fixtures
docs/                strategy, source validation proof, schema, architecture,
                     operations, commercial package, decision
```

## Documentation

- [STRATEGY.md](docs/STRATEGY.md) — 30 ideas, weighted scoring, top 10, winner
- [SOURCE_VALIDATION.md](docs/SOURCE_VALIDATION.md) — live API proofs & verdicts
- [SCHEMA.md](docs/SCHEMA.md) — canonical schema & field mapping
- [ARCHITECTURE.md](docs/ARCHITECTURE.md) — system, autonomy model, LLM plan
- [OPERATIONS.md](docs/OPERATIONS.md) — deployment & operating manual
- [COMMERCIAL.md](docs/COMMERCIAL.md) — pricing, outreach, validation gates
- [DECISION.md](docs/DECISION.md) — red-team review & final decision: **SELL**

Data licence: both sources are published under the Open Government Licence v3.
