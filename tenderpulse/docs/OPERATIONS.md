# Deployment & Operating Manual (Phases 12, 13)

## Deployment (Phase 12)

**Recommended host:** any £5–10/month VPS (Hetzner CX22, Lightsail, Fly.io).
No managed database needed at MVP scale — SQLite on the Docker volume.

```bash
git clone <repo> && cd tenderpulse
cp .env.example .env                  # edit if enabling Postgres/LLM
docker compose up -d --build          # starts api (:8000) + daily worker
docker compose exec api python -m pytest tests/ -q   # verify: 40 passed
```

Secrets: only `.env` (never committed). Postgres upgrade: uncomment
psycopg2 in requirements, set `DATABASE_URL`, restart — schema auto-creates.
SSL/domain: put Caddy or an nginx proxy in front (`caddy reverse-proxy
--from tenders.example.com --to localhost:8000`). Backups: nightly
`sqlite3 data/tenderpulse.db ".backup ..."` (or `pg_dump`) to object storage;
raw layer means the canonical DB is fully rebuildable. Rollback:
`git checkout <prev> && docker compose up -d --build` — data volume is
untouched. Update: pull, rebuild, rerun tests.

Security checklist: no inbound secrets; API is read-mostly (only
`/profiles` POST — put HTTP basic auth on the proxy before exposing
publicly); containers run as non-root-capable slim images; no personal data
stored beyond buyer contact points already published in official notices
(lawful, minimal, public-task basis; excluded from buyer-facing exports).

## Operating manual (Phase 13)

| Task | Command |
|---|---|
| Start / stop | `docker compose up -d` / `docker compose down` |
| Manual ingestion (backfill 7 days) | `docker compose exec worker python -m app.workers.ingest --source all --since-days 7` |
| View logs | `docker compose logs -f worker` |
| Source health / freshness | `curl localhost:8000/health` |
| Inspect quarantine | `sqlite3 data/tenderpulse.db "select reason,ocid from quarantine order by id desc limit 20"` |
| Re-run scoring | `docker compose exec worker python -c "from app.workers.ingest import rescore_all; rescore_all()"` |
| Generate a buyer digest | `curl localhost:8000/matches/1` (markdown) |
| Export CSV | `curl -O localhost:8000/matches/1/export.csv` |
| Add a customer profile | `curl -X POST localhost:8000/profiles -H 'content-type: application/json' -d '{"name":"...","keywords":[...],"cpv_prefixes":["72"]}'` |
| Back up | copy `data/` (or `pg_dump`) |
| Add a new source | new class in `app/connectors/` implementing `fetch()` + `notice_url()`, register in `CONNECTORS`, add fixture + tests |

**Is it broken?** `/health` shows a failed/stale run (>48 h old) → check
worker logs; a `source_unavailable` run self-heals on the next pass (window
overlap). Rising quarantine counts or a red schema-drift test → source
changed shape; inspect quarantine payloads before touching normalisation.

**Is it commercially working?** Track weekly: paying customers, churn,
digest-open responses, "did you bid anything we surfaced?" answers. Decision
rules in `COMMERCIAL.md` §validation gates; continue/park/kill criteria in
`DECISION.md`.
