"""Scoring engines for both canonical tables. Weights live in
config/scoring.yaml. The unverified-source penalty and the risk-field gates
are enforced HERE, centrally, so no adapter or job can skip them."""

from functools import lru_cache

import yaml

from . import CONFIG_DIR
from .registry import is_verified


@lru_cache
def _cfg() -> dict:
    with open(CONFIG_DIR / "scoring.yaml", encoding="utf-8") as fh:
        return yaml.safe_load(fh)


def _to_float(value, default=0.0) -> float:
    try:
        return float(str(value).replace("$", "").replace(",", ""))
    except (TypeError, ValueError):
        return default


# ---------------- Engine 1: claimable funds ----------------

def score_claim(claim: dict, resolution: dict | None, source_id: str) -> dict:
    cfg = _cfg()["claimable_funds"]
    rules = cfg["rules"]
    applied, score = [], 0

    def apply(rule):
        nonlocal score
        score += rules[rule]
        applied.append(rule)

    resolution = resolution or {}
    if _to_float(claim.get("amount")) > 10000:
        apply("amount_over_10000")
    if claim.get("claimant_type") == "business":
        apply("business_entity_claimant")
    elif claim.get("claimant_type") == "individual":
        apply("consumer_individual_claimant")
    if str(resolution.get("entity_status", "")).lower() in (
            "dissolved", "inactive", "merged", "forfeited", "revoked"):
        apply("claimant_dissolved_inactive_merged")
    if resolution.get("successor_entity") or resolution.get("registered_agent"):
        apply("successor_or_agent_found")
    if claim.get("claim_process_url"):
        apply("claim_process_clear")
    if claim.get("court_or_agency"):
        apply("official_court_or_agency_source")
    if resolution.get("resolution_confidence") in ("REVIEW", "NO_MATCH", "", None):
        apply("ownership_chain_unclear")
    if str(resolution.get("needs_attorney_review", "")).lower() in ("true", "yes", "1"):
        apply("fee_or_legal_restriction_unclear")
    if not is_verified(source_id):
        apply("source_not_verified")

    decision, reason = _claim_decision(score, claim, resolution, source_id, cfg)
    return {"claim_id": claim["claim_id"], "score": score,
            "decision": decision, "decision_reason": reason,
            "rules_applied": ";".join(applied)}


def _claim_decision(score, claim, resolution, source_id, cfg) -> tuple[str, str]:
    thresholds = cfg["decision_thresholds"]
    if not is_verified(source_id):
        return "PARK", "source not programmatically verified (-100); no production decision permitted"
    if str(resolution.get("needs_attorney_review", "")).lower() in ("true", "yes", "1"):
        return "LEGAL_REVIEW", "attorney review required before any action"
    route_complete = bool(claim.get("claim_process_url")) and \
        resolution.get("resolution_confidence") in ("HIGH", "MEDIUM")
    if score >= thresholds["sell_candidate"] and route_complete:
        return "SELL_CANDIDATE", "verified source, value and claimant route identified"
    if score >= thresholds["improve"]:
        return "IMPROVE", "value exists but claimant/buyer route incomplete"
    if score >= thresholds["park"]:
        return "PARK", "mechanism real but data or value too weak"
    return "KILL", "score below viability; no monetisable route"


# ---------------- Engine 2: government assets ----------------

COMPONENTS = ["hidden_reuse_score", "transport_access_score",
              "utility_access_score", "incentive_score", "flood_risk_score",
              "environmental_risk_score", "listing_thinness_score",
              "buyer_fit_score", "data_confidence_score"]


def score_asset(components: dict, enrichment: dict, source_id: str) -> dict:
    """components: each 0-10. Returns the canonical asset_scores row (minus
    asset_id, which the caller sets)."""
    cfg = _cfg()["government_assets"]
    weights = cfg["weights"]
    total = sum(_to_float(components.get(c)) * weights[c] for c in COMPONENTS) * 10
    verified = is_verified(source_id)
    if not verified:
        total += cfg["penalties"]["source_not_verified"]

    missing = [f for f in cfg["gates"]["required_risk_fields"]
               if not str(enrichment.get(f, "")).strip()]
    thresholds = cfg["decision_thresholds"]
    if not verified:
        decision, reason = "PARK", ("source not programmatically verified (-100); "
                                    "no bid recommendation permitted")
    elif missing:
        decision, reason = "IMPROVE", f"risk fields incomplete ({', '.join(missing)}); no bid recommendation"
    elif total >= thresholds["sell_candidate"]:
        decision, reason = "SELL_CANDIDATE", "verified source, risk fields complete, high opportunity score"
    elif total >= thresholds["improve"]:
        decision, reason = "IMPROVE", "opportunity present; enrichment or buyer fit incomplete"
    elif total >= thresholds["park"]:
        decision, reason = "PARK", "low opportunity score"
    else:
        decision, reason = "KILL", "no monetisable angle"

    row = {c: components.get(c, "") for c in COMPONENTS}
    row.update({"total_asset_opportunity_score": round(total, 1),
                "decision": decision, "decision_reason": reason})
    return row
