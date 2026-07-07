"""Engine 3: entity & successor resolution.

Given the ingested claimable_funds rows, resolve each stale claimant name
against the entity graph (data/entity_graph/entities.json — populated by
registry lookups, or data/fixtures/entity_graph.json in fixture runs).

Outputs:
  reports/latest/claimable_funds/claimant_resolution.csv
  reports/latest/entity_graph/{entities.csv,successor_matches.csv,
                               unresolved_entities.csv}

Confidence ladder (config in code, per brief):
  HIGH   — same registration number / explicit merger source
  MEDIUM — same normalised name + state + registered agent or address
  LOW    — name similarity only
  REVIEW — possible but insufficient evidence
  NO_MATCH — nothing reliable
"""

import _bootstrap  # noqa: F401

import argparse
import json

from core import DATA_DIR, ENTITY_GRAPH_DIR, FIXTURES_DIR, REPORTS_LATEST
from core.normalise import name_similarity, normalise_name
from core.schemas import (CLAIMANT_RESOLUTION, ENTITY_GRAPH, read_csv,
                          write_csv)

CLAIMS_CSV = REPORTS_LATEST / "claimable_funds" / "claimable_funds.csv"


def load_entity_graph(use_fixtures: bool) -> list[dict]:
    live = ENTITY_GRAPH_DIR / "entities.json"
    if live.exists():
        return json.loads(live.read_text(encoding="utf-8"))
    if use_fixtures:
        fixture = FIXTURES_DIR / "entity_graph.json"
        if fixture.exists():
            return json.loads(fixture.read_text(encoding="utf-8"))
    return []


def match_claimant(claimant_name: str, entities: list[dict]) -> tuple[dict | None, str, str]:
    """Return (entity, confidence, method)."""
    norm = normalise_name(claimant_name)
    best, best_sim = None, 0.0
    for entity in entities:
        entity_norm = entity.get("normalised_name") or normalise_name(entity["entity_name"])
        former = [normalise_name(f) for f in entity.get("former_names", [])]
        if norm == entity_norm or norm in former:
            method = "exact_name" if norm == entity_norm else "former_name"
            if entity.get("registration_number") or entity.get("merger_evidence_url"):
                return entity, "HIGH", method
            if entity.get("registered_agent") or entity.get("agent_address"):
                return entity, "MEDIUM", method
            return entity, "REVIEW", method
        sim = name_similarity(norm, entity_norm)
        if sim > best_sim:
            best, best_sim = entity, sim
    if best is not None and best_sim >= 0.8:
        return best, "REVIEW", "normalised_name"
    if best is not None and best_sim >= 0.6:
        return best, "LOW", "normalised_name"
    return None, "NO_MATCH", ""


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--fixtures", action="store_true")
    args = parser.parse_args()

    claims = read_csv(CLAIMS_CSV)
    entities = load_entity_graph(args.fixtures)
    print(f"{len(claims)} claims, {len(entities)} known entities")

    resolutions, matches, unresolved = [], [], []
    for claim in claims:
        entity, confidence, method = match_claimant(claim["claimant_name"], entities)
        entity = entity or {}
        status = entity.get("status", "")
        successor = entity.get("possible_successors", "")
        row = {
            "claim_id": claim["claim_id"],
            "claimant_name": claim["claimant_name"],
            "normalised_claimant_name": normalise_name(claim["claimant_name"]),
            "possible_current_entity": entity.get("entity_name", ""),
            "successor_entity": successor,
            "entity_status": status,
            "state_of_registration": entity.get("state", ""),
            "registered_agent": entity.get("registered_agent", ""),
            "officer_or_manager": entity.get("officers", ""),
            "dissolution_date": entity.get("dissolution_date", ""),
            "merger_or_acquisition_clue": entity.get("merger_clue", ""),
            "current_contact_route": entity.get("contact_route", ""),
            "resolution_confidence": confidence,
            "evidence_summary": (f"match method: {method}; source: "
                                 f"{entity.get('source_url', 'n/a')}") if method else "no match found",
            "needs_attorney_review": "yes" if confidence in ("HIGH", "MEDIUM")
                                     and str(status).lower() in ("dissolved", "merged")
                                     else "",
        }
        resolutions.append(row)
        if confidence in ("HIGH", "MEDIUM") and successor:
            matches.append({"claim_id": claim["claim_id"],
                            "claimant": claim["claimant_name"],
                            "successor": successor,
                            "confidence": confidence, "method": method})
        if confidence in ("REVIEW", "NO_MATCH"):
            unresolved.append({"claim_id": claim["claim_id"],
                               "claimant": claim["claimant_name"],
                               "confidence": confidence})

    write_csv(REPORTS_LATEST / "claimable_funds" / "claimant_resolution.csv",
              resolutions, CLAIMANT_RESOLUTION)

    graph_dir = REPORTS_LATEST / "entity_graph"
    entity_rows = [{k: e.get(k, "") for k in ENTITY_GRAPH} for e in entities]
    write_csv(graph_dir / "entities.csv", entity_rows, ENTITY_GRAPH)
    write_csv(graph_dir / "successor_matches.csv", matches,
              ["claim_id", "claimant", "successor", "confidence", "method"])
    write_csv(graph_dir / "unresolved_entities.csv", unresolved,
              ["claim_id", "claimant", "confidence"])
    print(f"resolved {len(resolutions)} claimants: "
          f"{len(matches)} successor matches, {len(unresolved)} unresolved")


if __name__ == "__main__":
    main()
