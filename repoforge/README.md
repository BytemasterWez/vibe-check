# RepoForge

Autonomous GitHub component-discovery and combination engine. RepoForge
continuously discovers useful open-source repositories, turns them into
structured **component cards**, matches complementary components, builds
candidate systems of 2–5 components, and scores each against **ten mandatory
gates**. A combination that earns ten `PASS` results (never an average, never
counting `UNKNOWN` as `PASS`) produces an evidence **dossier** and a Telegram
alert.

The score is deliberately labelled a **RepoForge technical-opportunity score**,
not a validated business. Commercial validation happens later (the dossier ships
with a copy-paste ChatGPT analysis block for exactly that).

> **Licence:** RepoForge's own code is **Apache-2.0** (see `LICENSE`). Apache-2.0
> was chosen over MIT because it adds an explicit patent grant and a clear
> NOTICE/attribution mechanism — appropriate for a tool that itself reasons
> about downstream licensing and commercial packaging.

---

## Implementation status (read this first)

This repository is a **working vertical slice**, built and verified end-to-end,
not a stub. What runs and is tested today:

| Area | Status |
| --- | --- |
| Config, operating modes (`metadata`/`local_ai`/`paused`) | ✅ implemented + tested |
| GitHub REST client (rate limits, ETag/conditional, pagination, backoff, budget) | ✅ implemented + tested |
| Discovery engine (search → dedup → checkpoint) with seed queries + date windows | ✅ implemented + tested |
| Cheap deterministic pre-filter (accept/quarantine/reject + evidence) | ✅ implemented + tested |
| Licence policy module (never marks unknown as safe) | ✅ implemented + tested |
| Component cards (metadata mode) | ✅ implemented + tested |
| Compatibility edges (output→input matching, adapters, evidence) | ✅ implemented + tested |
| Combination beam search (2–5 components, dedup) | ✅ implemented + tested |
| Ten gates + `ScoredCombination` (no averaging, `UNKNOWN`≠`PASS`) | ✅ implemented + tested |
| Dossier generation (Markdown + JSON + ChatGPT block) | ✅ implemented + tested |
| Telegram notifier with dedup | ✅ implemented + tested |
| FastAPI health/readiness/metrics/config + dashboard + admin-guarded mutations | ✅ implemented + tested |
| Reliability preflight (external-drive + APFS + disk checks) | ✅ implemented + tested |
| PostgreSQL advisory locks | ✅ implemented + tested |
| Full normalized schema (31 tables) + Alembic migration + pgvector | ✅ builds, migrates, verified in Docker |
| Docker Compose (app + pgvector), non-root, healthchecks, restart survival | ✅ built + verified |

**Scaffolded (schema/ADRs present, background loops not yet wired):** the
APScheduler daily/weekly cadence, recursive term discovery + quarantine
promotion, the Ollama classifier/embedding client, catalogue revisit, and
dead-letter processing. These have tables and interfaces but are not yet running
autonomous loops. They are the next slice. Nothing is faked — absent features
are simply absent, not stubbed with fake results.

---

## Storage layout (external APFS volume)

```
/Volumes/RepoForge/repoforge          # application source (this repo)
/Volumes/RepoForge/repoforge-data/
  postgres/    # database  (put on internal SSD if vector search gets slow)
  cache/       # downloaded metadata + cached READMEs
  dossiers/    # 10/10 reports (Markdown + JSON)
  backups/     # daily pg_dump archives
  tmp/         # temporary shallow clones (auto-deleted)
```

**Firm rule:** PostgreSQL's data directory must be on **APFS**. exFAT/FAT32/NTFS
are rejected at startup. On non-macOS hosts the APFS check is *skipped* (so CI
runs), never falsely failed.

---

## Quick start (Mac Mini)

```bash
# 0. Put this repo at /Volumes/RepoForge/repoforge
cd /Volumes/RepoForge/repoforge

# 1. Guided preflight: checks the drive, confirms APFS, creates dirs + .env
bash scripts/install_macos.sh

# 2. Add your GitHub token (read-only, public repo scope is enough)
#    Edit .env and set GITHUB_TOKEN=...  (optional: TELEGRAM_BOT_TOKEN/CHAT_ID)

# 3. (local_ai mode) install native Ollama and pull small models
#    https://ollama.com — then, e.g.:
ollama pull nomic-embed-text
ollama pull qwen2.5:7b-instruct
#    Set OLLAMA_CLASSIFIER_MODEL / OLLAMA_EMBEDDING_MODEL in .env to what you pulled.

# 4. Build and start (migrations apply automatically at boot)
docker compose up --build -d

# 5. Verify
curl -fsS http://localhost:18765/health          # {"status":"ok",...}
curl -fsS http://localhost:18765/ready            # {"ready":true,...}
open http://localhost:18765                        # dashboard

# 6. Optional live GitHub smoke test (uses a tiny slice of your API allowance)
make test-live
```

The service listens on `http://localhost:18765` and is reachable over your
Tailscale network at `http://<mac-mini-tailscale-name>:18765`.

## Operating modes

- `REPOFORGE_MODE=local_ai` (default) — native Ollama for classification + embeddings.
- `REPOFORGE_MODE=metadata` — deterministic GitHub metadata only; no Ollama needed.
- `REPOFORGE_MODE=paused` — dashboard/API stay up; discovery stops safely.

If Ollama is temporarily unavailable in `local_ai` mode, AI classification work
is queued (not lost) and discovery continues in deterministic mode.

## Everyday commands

```bash
docker compose up -d            # start
docker compose down             # stop
docker compose logs -f app      # inspect logs
docker compose exec app alembic upgrade head   # apply migrations manually
bash scripts/backup.sh          # backup DB (verifies + prunes by retention)
make test                       # unit + integration tests (no live GitHub)
make lint && make type          # ruff + mypy
```

## Recovery & reliability

- **Automatic restart:** both containers use `restart: unless-stopped` and have
  healthchecks; the app re-applies migrations idempotently on every boot, so it
  recovers cleanly after a crash, reboot, or `docker compose restart app`.
- **Checkpoints:** discovery stores a per-term cursor; a restart resumes from the
  last completed window rather than re-scanning.
- **External-drive loss:** if the data volume disappears, the readiness check
  fails and the preflight blocks DB-writing startup — RepoForge will **not**
  write into a freshly created empty mount-point on the internal disk.
- **Backups:** `scripts/backup.sh` runs `pg_dump`, verifies the gzip and dump
  header, and prunes archives older than `BACKUP_RETENTION_DAYS`.

### Restore from a backup

```bash
gunzip -c /Volumes/RepoForge/repoforge-data/backups/repoforge_YYYYMMDD_HHMMSS.sql.gz \
  | docker compose exec -T db psql -U repoforge -d repoforge
```

## Safe upgrade

```bash
cd /Volumes/RepoForge/repoforge
bash scripts/backup.sh          # always back up first
git pull
docker compose up --build -d    # migrations apply automatically
curl -fsS http://localhost:18765/ready
```

## Uninstall (without deleting your data)

```bash
docker compose down             # stops containers; leaves the data volume intact
# Your catalogue/dossiers/backups remain under /Volumes/RepoForge/repoforge-data
# To also remove data (irreversible): rm -rf /Volumes/RepoForge/repoforge-data
```

## Architecture

- **Python 3.12 · FastAPI · SQLAlchemy 2 · Alembic · Pydantic 2 · httpx.**
- **PostgreSQL 16 + pgvector** is the single backbone: database, work queue,
  scheduler state, deduplication store, and lock manager (advisory locks). No
  Redis/Celery/Kafka/Elasticsearch.
- **Ollama** runs natively on macOS for Apple-Silicon acceleration; the container
  reaches it at `http://host.docker.internal:11434`.
- Repository content is treated as **untrusted**: README text can never alter
  RepoForge's own instructions; the dashboard HTML-escapes all repo-derived text;
  no repository code, dependencies, or images are ever executed or installed.

See `docs/ARCHITECTURE.md` for the module map and data flow.

## Security

- Secrets live only in `.env` (gitignored) — never in source, logs, or the
  dashboard. The GitHub token is read-only and never rendered.
- Mutation endpoints require the `X-Admin-Token` header.
- Dependencies are pinned; the container runs as a non-root user.

## Tests

```bash
make test        # 69 tests, no network, no real GitHub allowance used
make test-live   # explicit live GitHub smoke test (needs GITHUB_TOKEN)
```

Fixtures are synthetic/recorded. The live test is deselected by default via the
`live` pytest marker.
