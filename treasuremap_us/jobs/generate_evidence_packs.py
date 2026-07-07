"""Generate opportunity cards (evidence packs) for the top-scored
opportunities in both engines.

Cards from fixture/unverified data carry a DEMO banner and can never be
SELL_CANDIDATE (decision comes from scoring, which applies -100).
"""

import _bootstrap  # noqa: F401

import argparse
import re

from core import REPORTS_LATEST
from core.cards import render_card
from core.registry import is_verified
from core.schemas import read_csv

ASSET_DIR = REPORTS_LATEST / "government_assets"
CLAIM_DIR = REPORTS_LATEST / "claimable_funds"

DEMO_BANNER = ("DEMO / FIXTURE DATA — this card was generated from "
               "synthetic pipeline-test data or an unverified source. "
               "Nothing here describes a real fund, asset or party.")


def slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:60]


def asset_cards(top_n: int) -> int:
    listings = {r["asset_id"]: r for r in read_csv(ASSET_DIR / "government_asset_listings.csv")}
    enrichment = {r["asset_id"]: r for r in read_csv(ASSET_DIR / "asset_enrichment.csv")}
    scores = read_csv(ASSET_DIR / "asset_scores.csv")[:top_n]
    out_dir = ASSET_DIR / "top_asset_cards"
    out_dir.mkdir(parents=True, exist_ok=True)
    for rank, score in enumerate(scores, 1):
        listing = listings.get(score["asset_id"], {})
        enr = enrichment.get(score["asset_id"], {})
        fixture = "[FIXTURE]" in listing.get("source_name", "")
        evidence = [
            {"fact": f"Listing: {listing.get('property_name', '')}",
             "source": listing.get("source_name", ""),
             "url": listing.get("listing_url") or listing.get("source_url", ""),
             "raw_path": listing.get("raw_file_path", ""),
             "confidence": "fixture" if fixture else "source page"},
            {"fact": f"FEMA flood zone: {enr.get('fema_flood_zone') or 'UNKNOWN'}",
             "source": "FEMA NFHL", "url": "https://hazards.fema.gov/",
             "raw_path": "", "confidence": "fixture" if fixture else "pending verification"},
            {"fact": f"Opportunity Zone: {enr.get('opportunity_zone') or 'UNKNOWN'}",
             "source": "CDFI Fund QOZ list", "url": "https://www.cdfifund.gov/opportunity-zones",
             "raw_path": "", "confidence": "fixture" if fixture else "pending verification"},
        ]
        risks = [r for r in [
            enr.get("risk_notes"),
            "title review not performed" ,
            "environmental review not performed",
            None if enr.get("fema_flood_zone") else "flood zone unknown",
            "auction competition unknown",
        ] if r]
        if score["decision"] != "SELL_CANDIDATE":
            risks.append("NO BID RECOMMENDATION — risk fields incomplete or source unverified")
        card = render_card(
            opportunity_type="Government asset (surplus/seized/forfeited real property)",
            source=listing.get("source_name", ""),
            state=listing.get("state", ""),
            amount_or_asset=(f"{listing.get('property_type', 'property')}: "
                             f"{listing.get('property_name', '')} — min bid "
                             f"{listing.get('minimum_bid') or 'n/a'}"),
            confidence=score.get("data_confidence_score", ""),
            decision=score["decision"],
            what_exists=(f"{listing.get('description') or listing.get('raw_text', '')} "
                         f"(sale method: {listing.get('sale_method', 'unknown')}; "
                         f"deadline: {listing.get('auction_deadline') or 'unknown'})"),
            why_overlooked=(f"listing thinness score "
                            f"{score.get('listing_thinness_score')}/10; hypothesis: "
                            f"{enr.get('highest_best_use_hypothesis') or 'not yet formed'}"),
            evidence=evidence,
            claim_route={
                "process": "n/a (asset acquisition, not a claim)",
                "auction_route": listing.get("sale_method", "see listing"),
                "attorney_review": "yes — title review before any bid",
                "registration": "bidder registration incl. deposit (see terms)",
                "deadline": listing.get("auction_deadline") or "unknown",
            },
            monetisation=["government asset opportunity pack ($500–$2,500)",
                          "developer/investor lead", "buyer representation (licensed partners only)"],
            risks=risks,
            next_action=("Complete flood/zoning/title enrichment, then shortlist "
                         "matching buyer types" if score["decision"] != "KILL"
                         else "Discard — no monetisable angle"),
            banner=DEMO_BANNER if fixture or not is_verified("gsa_real_property") else "",
        )
        (out_dir / f"{rank:02d}-{slug(listing.get('property_name', score['asset_id']))}.md").write_text(
            card, encoding="utf-8")
    print(f"wrote {len(scores)} asset cards -> {out_dir}")
    return len(scores)


def claim_cards(top_n: int) -> int:
    claims = {r["claim_id"]: r for r in read_csv(CLAIM_DIR / "claimable_funds.csv")}
    resolutions = {r["claim_id"]: r for r in read_csv(CLAIM_DIR / "claimant_resolution.csv")}
    scores = read_csv(CLAIM_DIR / "claim_scores.csv")[:top_n]
    out_dir = CLAIM_DIR / "top_claim_cards"
    out_dir.mkdir(parents=True, exist_ok=True)
    for rank, score in enumerate(scores, 1):
        claim = claims.get(score["claim_id"], {})
        res = resolutions.get(score["claim_id"], {})
        fixture = "[FIXTURE]" in claim.get("source_name", "")
        evidence = [
            {"fact": (f"Unclaimed funds ${claim.get('amount', '?')} in case "
                      f"{claim.get('case_number', '?')} ({claim.get('court_or_agency', '?')})"),
             "source": claim.get("source_name", ""), "url": claim.get("source_url", ""),
             "raw_path": claim.get("raw_file_path", ""),
             "confidence": "fixture" if fixture else "source record"},
            {"fact": (f"Claimant entity status: {res.get('entity_status') or 'unresolved'}; "
                      f"successor: {res.get('successor_entity') or 'none identified'}"),
             "source": "entity resolution", "url": "",
             "raw_path": "", "confidence": res.get("resolution_confidence", "")},
        ]
        if res.get("merger_or_acquisition_clue"):
            evidence.append({"fact": res["merger_or_acquisition_clue"],
                             "source": "merger clue", "url": "", "raw_path": "",
                             "confidence": res.get("resolution_confidence", "")})
        card = render_card(
            opportunity_type="Claimable funds (bankruptcy unclaimed funds, business claimant)",
            source=claim.get("source_name", ""),
            state=claim.get("state", "") or claim.get("county_or_district", ""),
            amount_or_asset=f"${claim.get('amount', '?')} ({claim.get('fund_type', '')})",
            confidence=res.get("resolution_confidence", "REVIEW"),
            decision=score["decision"],
            what_exists=(f"Court-held unclaimed funds payable to "
                         f"'{claim.get('claimant_name', '')}' in "
                         f"{claim.get('court_or_agency', '')} case "
                         f"{claim.get('case_number', '')}."),
            why_overlooked=(res.get("evidence_summary", "") or
                            "claimant appears stale/dissolved; no active claim on record"),
            evidence=evidence,
            claim_route={
                "process": (f"AO Form 1340 with the holding court — "
                            f"{claim.get('claim_process_url', '')}"),
                "auction_route": "n/a",
                "attorney_review": "yes" if res.get("needs_attorney_review") else "recommended",
                "registration": "per-court claimant documentation requirements",
                "deadline": "none typically, but funds may escheat — verify per court",
            },
            monetisation=["claim recovery lead pack ($250–$1,000)",
                          "attorney referral (where fee-lawful — check states.yaml)",
                          "research pack"],
            risks=[r for r in [
                "system never files claims — human/attorney route only",
                "state fee caps may restrict recovery-fee model",
                ("ownership chain unresolved" if res.get("resolution_confidence")
                 in ("REVIEW", "NO_MATCH", "LOW", "") else None),
            ] if r],
            next_action=("Package for attorney/recovery-firm review with successor evidence"
                         if score["decision"] in ("SELL_CANDIDATE", "LEGAL_REVIEW")
                         else "Strengthen successor evidence before packaging"),
            banner=DEMO_BANNER if fixture or not is_verified("bankruptcy_ucfl") else "",
        )
        (out_dir / f"{rank:02d}-{slug(claim.get('claimant_name', score['claim_id']))}.md").write_text(
            card, encoding="utf-8")
    print(f"wrote {len(scores)} claim cards -> {out_dir}")
    return len(scores)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--assets", type=int, default=20)
    parser.add_argument("--claims", type=int, default=25)
    args = parser.parse_args()
    asset_cards(args.assets)
    claim_cards(args.claims)


if __name__ == "__main__":
    main()
