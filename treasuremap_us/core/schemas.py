"""Canonical table schemas. CSV writers refuse rows with unknown keys so
adapters cannot silently drift from the canonical shape."""

import csv
from pathlib import Path

CLAIMABLE_FUNDS = [
    "claim_id", "source_name", "source_status", "source_url",
    "court_or_agency", "state", "county_or_district", "case_number",
    "case_name", "debtor_name", "claimant_name", "claimant_type",
    "amount", "fund_type", "date_deposited", "last_updated",
    "claim_process_url", "raw_text", "raw_file_path", "fetched_at",
]

CLAIMANT_RESOLUTION = [
    "claim_id", "claimant_name", "normalised_claimant_name",
    "possible_current_entity", "successor_entity", "entity_status",
    "state_of_registration", "registered_agent", "officer_or_manager",
    "dissolution_date", "merger_or_acquisition_clue",
    "current_contact_route", "resolution_confidence", "evidence_summary",
    "needs_attorney_review",
]

GOVERNMENT_ASSET_LISTINGS = [
    "asset_id", "source_name", "source_url", "listing_url",
    "listing_status", "sale_method", "auction_deadline", "property_name",
    "property_type", "address", "city", "state", "county", "lat", "lon",
    "acreage", "building_size", "minimum_bid", "current_bid",
    "description", "photos_url", "terms_url", "raw_text",
    "raw_file_path", "fetched_at",
]

ASSET_ENRICHMENT = [
    "asset_id", "parcel_id", "zoning", "land_use", "fema_flood_zone",
    "opportunity_zone", "brownfield_or_superfund_proximity", "road_access",
    "rail_access", "port_access", "utility_access_clues",
    "nearby_public_projects", "population_growth",
    "industrial_corridor_score", "redevelopment_incentives",
    "comparable_sales_proxy", "highest_best_use_hypothesis", "risk_notes",
]

ASSET_SCORES = [
    "asset_id", "hidden_reuse_score", "transport_access_score",
    "utility_access_score", "incentive_score", "flood_risk_score",
    "environmental_risk_score", "listing_thinness_score",
    "buyer_fit_score", "data_confidence_score",
    "total_asset_opportunity_score", "decision", "decision_reason",
]

CLAIM_SCORES = [
    "claim_id", "score", "decision", "decision_reason", "rules_applied",
]

ENTITY_GRAPH = [
    "entity_id", "entity_name", "normalised_name", "entity_type", "state",
    "status", "registration_number", "registered_agent", "agent_address",
    "officers", "addresses", "related_entities", "possible_successors",
    "possible_predecessors", "source_url", "confidence", "last_verified",
]

CONFIDENCE_LABELS = ["HIGH", "MEDIUM", "LOW", "REVIEW", "NO_MATCH"]
DECISIONS = ["SELL_CANDIDATE", "IMPROVE", "PARK", "KILL", "LEGAL_REVIEW"]

MATCH_METHODS = [
    "exact_name", "normalised_name", "former_name", "DBA",
    "registered_agent_match", "officer_match", "address_match",
    "SEC_filing_match", "merger_language_match", "press_release_match",
    "court_document_match", "manual_review",
]


def write_csv(path: Path, rows: list[dict], schema: list[str]) -> Path:
    """Write rows to CSV enforcing the canonical schema."""
    path.parent.mkdir(parents=True, exist_ok=True)
    for row in rows:
        unknown = set(row) - set(schema)
        if unknown:
            raise ValueError(f"{path.name}: non-canonical fields {unknown}")
    with open(path, "w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=schema)
        writer.writeheader()
        for row in rows:
            writer.writerow({k: row.get(k, "") for k in schema})
    return path


def read_csv(path: Path) -> list[dict]:
    if not path.exists():
        return []
    with open(path, newline="", encoding="utf-8") as fh:
        return list(csv.DictReader(fh))
