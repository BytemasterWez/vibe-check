"""Gate behaviour, including the critical rule that a 10/10 requires ten PASS
results and is never produced by averaging or by treating UNKNOWN as PASS."""

import json
from pathlib import Path

from app.combinations.builder import build_combinations
from app.extraction.component_card import build_card_from_metadata
from app.matching.edges import build_edges
from app.models.schemas import (
    Combination,
    ComponentCard,
    GateResult,
    GateState,
    LicenceClass,
    LicenceEvidence,
    Role,
    ScoredCombination,
)
from app.scoring.gates import score_combination

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures" / "repos.json"


def _load_good_cards() -> dict[str, ComponentCard]:
    repos = json.loads(FIXTURES.read_text())
    cards: dict[str, ComponentCard] = {}
    for r in repos:
        card = build_card_from_metadata(r, readme=r.get("_readme"))
        card.inputs = r["_inputs"]
        card.outputs = r["_outputs"]
        card.roles = [Role(x) for x in r["_roles"]]
        card.deployment.gpu_required = r["_gpu_required"]
        card.deployment.min_ram_mb = r["_min_ram_mb"]
        cards[f"{card.owner}/{card.repo}"] = card
    return cards


def _good_scored() -> ScoredCombination:
    cards = _load_good_cards()
    edges = build_edges(list(cards.values()))
    combos = build_combinations(cards, edges)
    combo = max(combos, key=lambda c: len(c.components))
    combo.product_name = "DocPipeline"
    combo.one_sentence = "Saves manual data-entry time by structuring scanned documents."
    return score_combination(combo, cards)


def test_known_good_combination_passes_all_ten_gates():
    scored = _good_scored()
    states = {g.gate: g.state for g in scored.gates}
    assert len(scored.gates) == 10
    assert all(s is GateState.PASS for s in states.values()), states
    assert scored.is_ten_of_ten is True
    assert scored.technical_opportunity_score == 10


def test_unknown_gate_blocks_ten_of_ten():
    cards = _load_good_cards()
    # Wipe one component's licence -> Gate 1 becomes UNKNOWN.
    victim = next(iter(cards.values()))
    victim.licence = LicenceEvidence(licence_class=LicenceClass.unknown, commercial_use=None)
    edges = build_edges(list(cards.values()))
    combo = max(build_combinations(cards, edges), key=lambda c: len(c.components))
    combo.one_sentence = "x"
    scored = score_combination(combo, cards)
    gate1 = next(g for g in scored.gates if g.gate == 1)
    assert gate1.state is GateState.UNKNOWN
    assert scored.is_ten_of_ten is False
    assert scored.technical_opportunity_score < 10


def test_ten_of_ten_never_from_averaging():
    # Nine PASS + one FAIL must NOT be 10/10 even though the average is high.
    gates = [
        GateResult(gate=i, name=f"g{i}", state=GateState.PASS) for i in range(1, 10)
    ]
    gates.append(GateResult(gate=10, name="g10", state=GateState.FAIL))
    combo = Combination(combo_id="cmb_x", components=["o/a", "o/b"])
    scored = ScoredCombination(combination=combo, gates=gates)
    assert scored.passed_count == 9
    assert scored.is_ten_of_ten is False


def test_unknown_is_never_pass():
    gates = [GateResult(gate=i, name=f"g{i}", state=GateState.PASS) for i in range(1, 10)]
    gates.append(GateResult(gate=10, name="g10", state=GateState.UNKNOWN))
    scored = ScoredCombination(
        combination=Combination(combo_id="cmb_y", components=["o/a"]), gates=gates
    )
    assert scored.is_ten_of_ten is False


def test_gpu_requirement_fails_deployability_gate():
    cards = _load_good_cards()
    for c in cards.values():
        c.deployment.gpu_required = True
    edges = build_edges(list(cards.values()))
    combo = max(build_combinations(cards, edges), key=lambda c: len(c.components))
    combo.one_sentence = "x"
    scored = score_combination(combo, cards)
    gate4 = next(g for g in scored.gates if g.gate == 4)
    assert gate4.state is GateState.FAIL


def test_missing_economic_hypothesis_is_unknown_not_pass():
    cards = _load_good_cards()
    edges = build_edges(list(cards.values()))
    combo = max(build_combinations(cards, edges), key=lambda c: len(c.components))
    combo.one_sentence = None  # no hypothesis stated
    scored = score_combination(combo, cards)
    gate9 = next(g for g in scored.gates if g.gate == 9)
    assert gate9.state is GateState.UNKNOWN
    assert scored.is_ten_of_ten is False
