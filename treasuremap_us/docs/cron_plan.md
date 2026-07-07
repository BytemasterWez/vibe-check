# Cron Plan

No live schedules are armed in this build: every source is `UNKNOWN`
(runner network policy — see `source_limitations.md`), and scheduling
scans that cannot reach their sources would only produce noise. Arm these
on the machine where `verify_sources.py` first passes.

```cron
# daily-source-verification — detect breakage/regression daily
0 10 * * *  cd /path/to/treasuremap_us && python jobs/verify_sources.py >> logs/verify.log 2>&1

# weekly-asset-scan — GSA/Treasury/USMS refresh + enrichment + scoring + cards
0 12 * * 1  cd /path/to/treasuremap_us && python jobs/ingest_government_assets.py && python jobs/enrich_assets.py && python jobs/score_opportunities.py && python jobs/generate_evidence_packs.py >> logs/assets.log 2>&1

# weekly-claimable-funds-scan — bankruptcy UCF seed queries + resolution
0 12 * * 2  cd /path/to/treasuremap_us && python jobs/ingest_claimable_funds.py && python jobs/resolve_entities.py && python jobs/score_opportunities.py && python jobs/generate_evidence_packs.py >> logs/claims.log 2>&1

# weekly-treasuremap-report — combined human-review report
0 14 * * 5  cd /path/to/treasuremap_us && python jobs/weekly_report.py >> logs/report.log 2>&1
```

Rules baked into the jobs (no cron-side care needed):

- Ingest jobs skip any source whose effective status is not cron-safe
  (`VERIFIED_API` / `VERIFIED_DOWNLOAD` / `VERIFIED_HTML_INDEX`);
  `VERIFIED_SEARCH_FORM` sources (UCFL) run at polite seed-query volume
  only, and `VERIFIED_BROWSER_SESSION` / `VERIFIED_MANUAL_ONLY` sources
  never run unattended.
- `verify_sources.py` exits 1 when a previously verified source
  regresses — wire that to an alert (email/ntfy) so scans pause.
- All fetches are rate-limited (≥5s/host), UA-identified, robots-aware,
  and raw-archived under `data/raw/` for the evidence trail.
