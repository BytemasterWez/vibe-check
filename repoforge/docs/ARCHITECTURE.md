# RepoForge architecture

## Data flow

```
discovery.queries  ─┐
                    ▼
GitHubClient ──► DiscoveryEngine ──► prefilter ──► repositories (accept/quarantine/reject + evidence)
   (rate limits,        (dedup,            (cheap
    conditional,         checkpoint)        deterministic
    budget)                                 filters)
                                                │  accepted
                                                ▼
                                    extraction.component_card ──► ComponentCard
                                    (metadata mode today;          (+ provenance,
                                     local_ai adds Ollama)          licence evidence)
                                                │
                                                ▼
                                    matching.edges ──► CompatibilityEdge (output→input, adapter, evidence)
                                                │
                                                ▼
                                    combinations.builder ──► Combination (beam search, 2–5, deduped)
                                                │
                                                ▼
                                    scoring.gates ──► ScoredCombination (10 gates, PASS/FAIL/UNKNOWN)
                                                │  is_ten_of_ten
                                                ▼
                                    dossiers.generator ──► JSON + Markdown dossier
                                                │
                                                ▼
                                    notifications.telegram ──► deduplicated alert
```

## Module map (`app/`)

| Module | Responsibility |
| --- | --- |
| `config.py` | Env-driven settings; `safe_status()` redacts secrets. |
| `models/schemas.py` | Pydantic domain contracts + provenance. Validated at every boundary. |
| `discovery/github_client.py` | GitHub REST client: rate limits, ETag, pagination, backoff, budget. |
| `discovery/queries.py` | Seed capability families + date-window splitting. |
| `discovery/prefilter.py` | Cheap deterministic accept/quarantine/reject with evidence. |
| `discovery/engine.py` | Search → dedup → prefilter → checkpoint. Storage injected via protocol. |
| `extraction/component_card.py` | Build component cards (metadata mode; local_ai enrichment planned). |
| `licensing/policy.py` | SPDX → class + commercial-use; never marks unknown as safe. |
| `matching/edges.py` | Output→input matching, adapters, licence/deployment compatibility. |
| `combinations/builder.py` | Constrained beam search; dedup by component set. |
| `scoring/gates.py` | The ten gates. `is_ten_of_ten` requires ten PASS, no averaging. |
| `dossiers/generator.py` | JSON + Markdown dossier + ChatGPT analysis block. |
| `notifications/telegram.py` | Alert dispatch with dedup; no-op when unconfigured. |
| `reliability/preflight.py` | External-drive, APFS, disk-space checks. |
| `reliability/locks.py` | PostgreSQL advisory locks for single-run scheduled tasks. |
| `database/models.py` | 31 normalized ORM tables (history-preserving snapshots). |
| `main.py` | FastAPI app: health/readiness/metrics/config + dashboard + mutations. |

## Why PostgreSQL for everything

A single Mac Mini does not need Redis/Celery/Kafka. PostgreSQL 16 provides:
persistence, a `jobs`/`dead_letter_jobs` work queue, scheduler state
(`scheduler_runs`), a deduplication store (unique constraints on GitHub id and
combination fingerprint), and a lock manager (advisory locks). pgvector holds
embeddings with an ivfflat cosine index.

## Key invariants (enforced by tests)

1. An `UNKNOWN` gate is never counted as `PASS`; a 10/10 needs ten literal PASS.
2. A licence that is unknown/ambiguous/conflicting is never marked commercially safe.
3. Repository content is untrusted data; it cannot alter RepoForge instructions,
   and the dashboard escapes it.
4. If the external volume vanishes, DB-writing startup is blocked — no silent
   fallback to the internal disk.
5. Tests never spend the real GitHub allowance (the live test is opt-in).
