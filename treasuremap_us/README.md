# TreasureMap US

A source-verified evidence-pack machine for finding stale claimable money,
under-enriched government asset listings, and the successor entities that
connect them to a lawful route — **not a scraper, not a dashboard**.

Every opportunity the system emits is a markdown **Opportunity Card**
answering five questions: what exists, who may have a claim or buyer
interest, what public source proves it, what legal/claim/acquisition route
applies, and how to monetise it ethically (lead pack, referral, research
pack, or buyer lead).

## The core rule, enforced in code

**No source is production until access is programmatically verified.**

- `jobs/verify_sources.py` probes every source in `config/sources.yaml`
  (replay-tested, robots-aware, rate-limited, UA-identified) and records
  an honest status to `data/source_verification/`.
- `core/registry.py` resolves the *effective* status from that record
  only — declared expectations never count.
- `core/scoring.py` applies **-100 to any opportunity from an unverified
  source**, capping its decision at PARK. No SELL_CANDIDATE, no bid
  recommendation, no outreach-eligible lead can come from an unverified
  source. This is central and cannot be bypassed by an adapter.
- Ingest jobs refuse to run live against non-cron-safe sources
  (`NotCronSafe`); `--fixtures` runs labelled synthetic data instead.

## Current state (V1, built 2026-07-07)

| Piece | State |
|-------|-------|
| Source registry + verifier | ✅ built, run live — all 10 sources `UNKNOWN`: this build environment's egress policy blocks all government hosts (see `docs/source_limitations.md`) |
| Engine 2 (asset mispricing): ingest → enrich → score → cards | ✅ runs end-to-end (fixture mode): 20 listings, 20 cards |
| Engine 1 (claimable funds): ingest → filter → score → cards | ✅ runs end-to-end (fixture mode): 26 business claims ≥ $5k, 25 cards |
| Engine 3 (entity/successor resolution) | ✅ runs: normalisation, former-name/merger matching, confidence ladder, successor_matches.csv |
| Evidence pack generator | ✅ brief-format cards with evidence tables, routes, risks, DEMO banners |
| Weekly report + archive | ✅ `reports/latest/treasuremap_weekly_report.md` |
| Cron schedules | 📋 specified in `docs/cron_plan.md`; arm only where verification passes |
| Outreach | manual-only tracker (`reports/latest/outreach_tracker.csv`), cap 10/week, commercial recipients only |

## Quick start

```bash
cd treasuremap_us
pip install -r requirements.txt

# 1. Verify sources (the gatekeeper — run from a network-open machine)
python jobs/verify_sources.py

# 2. Pipeline (drop --fixtures once sources verify)
python jobs/ingest_government_assets.py --fixtures
python jobs/ingest_claimable_funds.py  --fixtures
python jobs/resolve_entities.py        --fixtures
python jobs/enrich_assets.py           --fixtures
python jobs/score_opportunities.py
python jobs/generate_evidence_packs.py
python jobs/weekly_report.py
```

Outputs land in `reports/latest/` (cards under
`government_assets/top_asset_cards/` and
`claimable_funds/top_claim_cards/`).

## Layout

```
config/     sources.yaml (registry) · scoring.yaml · states.yaml (incl. fee-cap notes)
            search_terms.yaml · monetisation_rules.yaml
core/       registry (status resolution) · http (polite fetch + raw archive)
            schemas (canonical tables) · scoring · normalise · cards
adapters/   one per source; base.py defines verify()/fetch() contract
jobs/       verify_sources · ingest_* · resolve_entities · enrich_assets
            score_opportunities · generate_evidence_packs · weekly_report
data/       raw/ (fetch archive) · source_verification/ · fixtures/ · entity_graph/
reports/    latest/ · archive/
docs/       endpoint inventories (UCFL/GSA/Treasury/USMS) · source_limitations · cron_plan
```

## Hard safety rules (also machine-readable in `config/monetisation_rules.yaml`)

The system never: submits claims, asserts entitlement, impersonates
claimants, contacts consumers/vulnerable individuals first, bypasses
CAPTCHA, scrapes against terms, recommends a bid without complete
title/environmental risk fields, or charges fees where state law
prohibits or caps them. Business/entity claimants only in PHASE 1;
individuals are filtered out at ingest.

## Next steps (in order)

1. Re-run `jobs/verify_sources.py` from a network-open environment;
   statuses recorded there unlock the rest automatically.
2. Capture real pages for UCFL/Treasury/GSA; validate the parsers against
   captures (they are heuristic until then, by design).
3. Get a free api.data.gov key (`GSA_API_KEY`) and test the GSA Auctions
   API for real-property coverage.
4. One-time QOZ tract download → `data/processed/qoz_tracts.csv`.
5. Arm the cron plan; run Week-2 (assets) and Week-3 (claims) of the
   30-day plan on live data; then the Week-4 monetisation test with 10
   manual sends tracked in `outreach_tracker.csv`.
