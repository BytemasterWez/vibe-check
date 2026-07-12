"""The ten mandatory scoring gates.

Each gate returns PASS / FAIL / UNKNOWN with evidence. A 10/10 requires ten
PASS results — never an average, and UNKNOWN is never treated as PASS. The
resulting number is the "RepoForge technical-opportunity score", explicitly not
a commercial validation.
"""

from __future__ import annotations

from app.models.schemas import (
    Combination,
    ComponentCard,
    GateResult,
    GateState,
    ScoredCombination,
)

# Affordable deployment target the whole system must fit within (Gate 4).
AFFORDABLE_TARGET_RAM_MB = 16_384
AFFORDABLE_TARGET_ALLOWS_GPU = False


def _cards_for(combo: Combination, cards: dict[str, ComponentCard]) -> list[ComponentCard]:
    return [cards[c] for c in combo.components if c in cards]


# --------------------------------------------------------------------------- #
def gate1_licence(cards: list[ComponentCard]) -> GateResult:
    ev: list[str] = []
    contra: list[str] = []
    unk: list[str] = []
    for c in cards:
        lic = c.licence
        key = f"{c.owner}/{c.repo}"
        if lic.commercial_use is None:
            unk.append(f"{key}: licence commercial-use unknown ({lic.licence_class.value})")
        elif lic.commercially_safe:
            ev.append(f"{key}: {lic.spdx_id} usable for commercial packaging")
        else:
            contra.append(f"{key}: {lic.licence_class.value} not usable for packaging")
    if contra:
        state = GateState.FAIL
    elif unk:
        state = GateState.UNKNOWN
    else:
        state = GateState.PASS
    return GateResult(gate=1, name="Licence compatibility", state=state,
                      evidence=ev, contradictions=contra, unknowns=unk)


def gate2_complementarity(cards: list[ComponentCard]) -> GateResult:
    roles = [r for c in cards for r in c.roles]
    distinct = set(roles)
    ev: list[str] = []
    contra: list[str] = []
    unk: list[str] = []
    if not roles:
        unk.append("no functional roles extracted for any component")
        return GateResult(gate=2, name="Functional complementarity",
                          state=GateState.UNKNOWN, unknowns=unk)
    duplicated = len(roles) - len(distinct)
    if len(distinct) >= max(2, len(cards)):
        ev.append(f"{len(distinct)} distinct roles across {len(cards)} components")
        state = GateState.PASS
    elif duplicated >= len(cards):
        contra.append("components largely duplicate each other's roles")
        state = GateState.FAIL
    else:
        unk.append("partial role overlap; complementarity unclear")
        state = GateState.UNKNOWN
    return GateResult(gate=2, name="Functional complementarity", state=state,
                      evidence=ev, contradictions=contra, unknowns=unk)


def gate3_interfaces(combo: Combination) -> GateResult:
    ev: list[str] = []
    contra: list[str] = []
    unk: list[str] = []
    if not combo.edges:
        unk.append("no compatibility edges recorded")
        return GateResult(gate=3, name="Interface compatibility",
                          state=GateState.UNKNOWN, unknowns=unk)
    weak = [e for e in combo.edges if e.confidence < 0.4]
    for e in combo.edges:
        if e.evidence:
            ev.append(f"{e.source} -> {e.destination}: {e.evidence[0]}")
    if weak and len(weak) == len(combo.edges):
        unk.append("all edges are low-confidence")
        state = GateState.UNKNOWN
    else:
        state = GateState.PASS
    return GateResult(gate=3, name="Interface compatibility", state=state,
                      evidence=ev, contradictions=contra, unknowns=unk)


def gate4_deployability(cards: list[ComponentCard]) -> GateResult:
    ev: list[str] = []
    contra: list[str] = []
    unk: list[str] = []
    total_ram = 0
    ram_known = True
    for c in cards:
        key = f"{c.owner}/{c.repo}"
        if c.deployment.gpu_required is True and not AFFORDABLE_TARGET_ALLOWS_GPU:
            contra.append(f"{key}: requires GPU; target has none")
        if c.deployment.min_ram_mb is None:
            ram_known = False
            unk.append(f"{key}: minimum RAM unknown")
        else:
            total_ram += c.deployment.min_ram_mb
    if contra:
        state = GateState.FAIL
    elif not ram_known:
        state = GateState.UNKNOWN
    elif total_ram <= AFFORDABLE_TARGET_RAM_MB:
        ev.append(f"combined RAM {total_ram}MB fits {AFFORDABLE_TARGET_RAM_MB}MB target")
        state = GateState.PASS
    else:
        contra.append(f"combined RAM {total_ram}MB exceeds {AFFORDABLE_TARGET_RAM_MB}MB")
        state = GateState.FAIL
    return GateResult(gate=4, name="Affordable deployability", state=state,
                      evidence=ev, contradictions=contra, unknowns=unk)


def gate5_maturity(cards: list[ComponentCard]) -> GateResult:
    ev: list[str] = []
    contra: list[str] = []
    unk: list[str] = []
    for c in cards:
        key = f"{c.owner}/{c.repo}"
        if c.archived:
            contra.append(f"{key}: archived")
        elif c.maturity_score >= 0.4:
            ev.append(f"{key}: maturity {c.maturity_score}")
        else:
            unk.append(f"{key}: maturity {c.maturity_score} below threshold")
    if contra:
        state = GateState.FAIL
    elif unk:
        state = GateState.UNKNOWN
    else:
        state = GateState.PASS
    return GateResult(gate=5, name="Component maturity", state=state,
                      evidence=ev, contradictions=contra, unknowns=unk)


def gate6_workflow(cards: list[ComponentCard]) -> GateResult:
    """End-to-end workflow: needs an ingest/collect, a transform/reason, and an
    output/report role present across the components."""
    from app.models.schemas import Role

    roles = {r for c in cards for r in c.roles}
    ingest = roles & {Role.collector, Role.ingestor, Role.parser, Role.observer}
    process = roles & {Role.transformer, Role.classifier, Role.reasoner, Role.optimiser,
                       Role.validator}
    output = roles & {Role.reporter, Role.interface, Role.automation, Role.knowledge_store}
    ev: list[str] = []
    unk: list[str] = []
    have = sum(bool(x) for x in (ingest, process, output))
    if have == 3:
        ev.append("ingest -> process -> output stages all present")
        state = GateState.PASS
    elif have == 0:
        unk.append("no recognisable workflow stages")
        state = GateState.UNKNOWN
    else:
        unk.append(f"only {have}/3 workflow stages present")
        state = GateState.UNKNOWN
    return GateResult(gate=6, name="Workflow completeness", state=state,
                      evidence=ev, unknowns=unk)


def gate7_packaging_gap(cards: list[ComponentCard], combo: Combination) -> GateResult:
    """Evidence that the exact combined workflow isn't already trivially packaged.
    Deterministic heuristic: if any single component already covers all roles of
    the others, the gap is weak. Without external market data this is often
    UNKNOWN — and we say so rather than assume a gap exists."""
    ev: list[str] = []
    unk: list[str] = []
    role_sets = [set(c.roles) for c in cards]
    union = set().union(*role_sets) if role_sets else set()
    dominant = any(rs == union and len(rs) > 1 for rs in role_sets)
    if dominant:
        return GateResult(gate=7, name="Packaging gap", state=GateState.FAIL,
                          contradictions=["one component already covers the combined roles"])
    if len(cards) >= 2 and union and not dominant:
        ev.append("no single component covers the full combined role set")
        state = GateState.PASS
    else:
        unk.append("insufficient evidence about existing packaged solutions")
        state = GateState.UNKNOWN
    return GateResult(gate=7, name="Packaging gap", state=state, evidence=ev, unknowns=unk)


def gate8_prototype(cards: list[ComponentCard], combo: Combination,
                    min_days: int = 14, max_days: int = 30) -> GateResult:
    """Prototype feasible in 14-30 days if the chain is short, interfaces exist,
    and integration difficulty is not uniformly high."""
    ev: list[str] = []
    contra: list[str] = []
    unk: list[str] = []
    n = len(cards)
    if n < 2 or n > 5:
        contra.append(f"chain length {n} outside 2-5 component bound")
        return GateResult(gate=8, name="Prototype feasibility",
                          state=GateState.FAIL, contradictions=contra)
    if not combo.edges:
        unk.append("no edges to estimate integration effort")
        return GateResult(gate=8, name="Prototype feasibility",
                          state=GateState.UNKNOWN, unknowns=unk)
    hard = [e for e in combo.edges if e.integration_difficulty == "high"]
    est_days = min_days + 4 * (n - 2) + 5 * len(hard)
    if est_days <= max_days:
        ev.append(f"estimated ~{est_days} days within {min_days}-{max_days} window")
        state = GateState.PASS
    else:
        contra.append(f"estimated ~{est_days} days exceeds {max_days}")
        state = GateState.FAIL
    return GateResult(gate=8, name="Prototype feasibility", state=state,
                      evidence=ev, contradictions=contra, unknowns=unk)


def gate9_economics(combo: Combination) -> GateResult:
    """Economic hypothesis. This is a HYPOTHESIS unless independently verified;
    it PASSes only when an explicit hypothesis string is attached."""
    ev: list[str] = []
    unk: list[str] = []
    if combo.one_sentence:
        ev.append("stated value hypothesis: " + combo.one_sentence)
        ev.append("NOTE: hypothesis only — commercial validation happens in ChatGPT")
        state = GateState.PASS
    else:
        unk.append("no economic value hypothesis stated")
        state = GateState.UNKNOWN
    return GateResult(gate=9, name="Economic hypothesis", state=state,
                      evidence=ev, unknowns=unk)


def gate10_differentiation(cards: list[ComponentCard], combo: Combination) -> GateResult:
    """Differentiation beyond 'add AI'. Passes when the combination spans
    multiple domains/roles that create a specific advantage, not a single wrapper."""
    ev: list[str] = []
    unk: list[str] = []
    langs = {lang for c in cards for lang in c.languages}
    roles = {r for c in cards for r in c.roles}
    if len(roles) >= 3 and len(combo.edges) >= len(cards) - 1:
        ev.append(
            f"specific advantage from a connected {len(roles)}-role pipeline "
            f"({len(combo.edges)} evidenced integrations), not a lone AI wrapper"
        )
        if langs:
            ev.append(f"spans languages: {', '.join(sorted(langs))}")
        state = GateState.PASS
    else:
        unk.append("differentiation beyond 'add AI' not established")
        state = GateState.UNKNOWN
    return GateResult(gate=10, name="Differentiation", state=state, evidence=ev, unknowns=unk)


def score_combination(
    combo: Combination, cards: dict[str, ComponentCard]
) -> ScoredCombination:
    cl = _cards_for(combo, cards)
    gates = [
        gate1_licence(cl),
        gate2_complementarity(cl),
        gate3_interfaces(combo),
        gate4_deployability(cl),
        gate5_maturity(cl),
        gate6_workflow(cl),
        gate7_packaging_gap(cl, combo),
        gate8_prototype(cl, combo),
        gate9_economics(combo),
        gate10_differentiation(cl, combo),
    ]
    return ScoredCombination(combination=combo, gates=gates)
