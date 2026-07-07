"""Score both engines' opportunities and assign decisions.

Asset component scores (0-10) are derived from enrichment fields with
transparent heuristics below; claimable-funds scores follow the rule
table in scoring.yaml. Unverified sources take -100 centrally in
core.scoring — a fixture run therefore demonstrably caps at PARK.
"""

import _bootstrap  # noqa: F401

from core import REPORTS_LATEST
from core.schemas import ASSET_SCORES, CLAIM_SCORES, read_csv, write_csv
from core.scoring import score_asset, score_claim

ASSET_DIR = REPORTS_LATEST / "government_assets"
CLAIM_DIR = REPORTS_LATEST / "claimable_funds"

SOURCE_IDS = {"GSA": "gsa_real_property", "Treasury": "treasury_seized_rp",
              "USMS": "usms_forfeited_rp",
              "U.S. Courts": "bankruptcy_ucfl"}


def source_id_for(source_name: str) -> str:
    for marker, source_id in SOURCE_IDS.items():
        if marker.lower() in source_name.lower():
            return source_id
    return "unknown_source"   # never verified -> -100 by design


def asset_components(listing: dict, enrichment: dict) -> dict:
    """Transparent 0-10 heuristics. Tune in code review, not silently."""
    def scale(cond_high, cond_mid):
        return 8 if cond_high else (5 if cond_mid else 2)

    desc = (listing.get("description", "") + " " + listing.get("raw_text", "")).lower()
    flood_zone = enrichment.get("fema_flood_zone", "")
    env = enrichment.get("brownfield_or_superfund_proximity", "")
    filled = sum(1 for k, v in enrichment.items() if str(v).strip())
    return {
        "hidden_reuse_score": scale(bool(enrichment.get("highest_best_use_hypothesis")),
                                    bool(enrichment.get("land_use"))),
        "transport_access_score": scale(
            enrichment.get("rail_access") == "yes" or enrichment.get("port_access") == "yes",
            enrichment.get("road_access") == "yes"),
        "utility_access_score": scale(False, bool(enrichment.get("utility_access_clues"))),
        "incentive_score": scale(enrichment.get("opportunity_zone") == "yes",
                                 bool(enrichment.get("redevelopment_incentives"))),
        # inverted risk: high score = low risk; unknown = midline 5
        "flood_risk_score": 8 if flood_zone.startswith(("X", "NONE"))
                            else (2 if flood_zone.startswith(("A", "V")) else 5),
        "environmental_risk_score": 8 if env == "none known"
                                    else (2 if env and env != "none known" else 5),
        "listing_thinness_score": 8 if len(desc) < 400 else (5 if len(desc) < 1200 else 2),
        "buyer_fit_score": scale(bool(enrichment.get("highest_best_use_hypothesis"))
                                 and bool(enrichment.get("comparable_sales_proxy")),
                                 bool(enrichment.get("highest_best_use_hypothesis"))),
        "data_confidence_score": min(10, round(filled / len(enrichment) * 10)) if enrichment else 0,
    }


def main():
    # ---- assets ----
    listings = read_csv(ASSET_DIR / "government_asset_listings.csv")
    enrichment = {r["asset_id"]: r for r in read_csv(ASSET_DIR / "asset_enrichment.csv")}
    asset_rows = []
    for listing in listings:
        enr = enrichment.get(listing["asset_id"], {})
        row = score_asset(asset_components(listing, enr), enr,
                          source_id_for(listing["source_name"]))
        row["asset_id"] = listing["asset_id"]
        asset_rows.append(row)
    asset_rows.sort(key=lambda r: -float(r["total_asset_opportunity_score"]))
    write_csv(ASSET_DIR / "asset_scores.csv", asset_rows, ASSET_SCORES)
    print(f"scored {len(asset_rows)} assets")

    # ---- claims ----
    claims = read_csv(CLAIM_DIR / "claimable_funds.csv")
    resolutions = {r["claim_id"]: r
                   for r in read_csv(CLAIM_DIR / "claimant_resolution.csv")}
    claim_rows = [score_claim(c, resolutions.get(c["claim_id"]),
                              source_id_for(c["source_name"])) for c in claims]
    claim_rows.sort(key=lambda r: -r["score"])
    write_csv(CLAIM_DIR / "claim_scores.csv", claim_rows, CLAIM_SCORES)
    print(f"scored {len(claim_rows)} claims")


if __name__ == "__main__":
    main()
