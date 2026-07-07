"""Weekly TreasureMap US report: aggregates both engines, verification
state and the outreach tracker into reports/latest/treasuremap_weekly_report.md,
and snapshots it to reports/archive/. Human review artefact — nothing in
it is sent anywhere automatically."""

import _bootstrap  # noqa: F401

import shutil
from collections import Counter
from datetime import datetime, timezone

from core import REPORTS_ARCHIVE, REPORTS_LATEST, VERIFICATION_DIR
from core.registry import load_sources, load_verification
from core.schemas import read_csv

ASSET_DIR = REPORTS_LATEST / "government_assets"
CLAIM_DIR = REPORTS_LATEST / "claimable_funds"


def decision_summary(rows) -> str:
    counts = Counter(r["decision"] for r in rows)
    return ", ".join(f"{d}: {n}" for d, n in counts.most_common()) or "none"


def main():
    now = datetime.now(timezone.utc)
    asset_scores = read_csv(ASSET_DIR / "asset_scores.csv")
    claim_scores = read_csv(CLAIM_DIR / "claim_scores.csv")
    claims = {r["claim_id"]: r for r in read_csv(CLAIM_DIR / "claimable_funds.csv")}
    listings = {r["asset_id"]: r for r in read_csv(ASSET_DIR / "government_asset_listings.csv")}

    lines = [
        "# TreasureMap US — Weekly Report",
        f"\nGenerated: {now.strftime('%Y-%m-%d %H:%M UTC')}",
        "\n## Source verification state",
        "\n| Source | Effective status | Production-ready |",
        "|--------|------------------|------------------|",
    ]
    fixture_run = False
    for source_id, cfg in load_sources().items():
        record = load_verification(source_id) or {}
        status = record.get("status", "UNKNOWN")
        lines.append(f"| {cfg['name']} | {status} | "
                     f"{'yes' if status.startswith('VERIFIED') else 'NO'} |")

    lines += ["\n## Engine 2 — Government asset mispricing",
              f"\nListings scored: {len(asset_scores)} "
              f"({decision_summary(asset_scores)})",
              "\n| Rank | Asset | State | Score | Decision |",
              "|------|-------|-------|-------|----------|"]
    for i, s in enumerate(asset_scores[:10], 1):
        listing = listings.get(s["asset_id"], {})
        if "[FIXTURE]" in listing.get("source_name", ""):
            fixture_run = True
        lines.append(f"| {i} | {listing.get('property_name', s['asset_id'])} "
                     f"| {listing.get('state', '')} "
                     f"| {s['total_asset_opportunity_score']} | {s['decision']} |")

    lines += ["\n## Engine 1 — Claimable funds (business claimants)",
              f"\nClaims scored: {len(claim_scores)} "
              f"({decision_summary(claim_scores)})",
              "\n| Rank | Claimant | Amount | Score | Decision |",
              "|------|----------|--------|-------|----------|"]
    for i, s in enumerate(claim_scores[:10], 1):
        claim = claims.get(s["claim_id"], {})
        if "[FIXTURE]" in claim.get("source_name", ""):
            fixture_run = True
        lines.append(f"| {i} | {claim.get('claimant_name', s['claim_id'])} "
                     f"| ${claim.get('amount', '?')} | {s['score']} | {s['decision']} |")

    outreach = read_csv(REPORTS_LATEST / "outreach_tracker.csv")
    lines += ["\n## Monetisation / outreach tracker",
              f"\nTracked outreach rows: {len(outreach)} "
              "(manual sends only; cap 10/week; commercial recipients only)"]

    if fixture_run:
        lines += ["\n> **FIXTURE RUN** — some or all rows above are synthetic "
                  "pipeline-test data. No real funds, assets or parties are "
                  "described. No outreach may be based on this report."]
    lines += ["\n---",
              "*Review artefact only. No claims are filed, no outreach is "
              "sent, and no bid is recommended by this system.*", ""]

    # per-engine summaries (brief output spec)
    (ASSET_DIR / "government_asset_summary.md").write_text(
        f"# Government Assets — Summary\n\nGenerated: {now.isoformat()}\n\n"
        f"Listings: {len(listings)} · Scored: {len(asset_scores)} · "
        f"Decisions: {decision_summary(asset_scores)}\n\n"
        "Top cards: `top_asset_cards/`. No bid is recommended unless a "
        "card's decision is SELL_CANDIDATE with complete risk fields.\n",
        encoding="utf-8")
    (CLAIM_DIR / "claimable_funds_summary.md").write_text(
        f"# Claimable Funds — Summary\n\nGenerated: {now.isoformat()}\n\n"
        f"Business claims kept: {len(claims)} · Scored: {len(claim_scores)} · "
        f"Decisions: {decision_summary(claim_scores)}\n\n"
        "Top cards: `top_claim_cards/`. The system never files claims; "
        "cards are research packs for professional review.\n",
        encoding="utf-8")

    out = REPORTS_LATEST / "treasuremap_weekly_report.md"
    out.write_text("\n".join(lines), encoding="utf-8")
    snapshot = REPORTS_ARCHIVE / f"treasuremap_weekly_report_{now.strftime('%Y-%m-%d')}.md"
    snapshot.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy(out, snapshot)
    print(f"report -> {out}\narchive -> {snapshot}")


if __name__ == "__main__":
    main()
