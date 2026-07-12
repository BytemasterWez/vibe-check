from app.combinations.builder import build_combinations
from app.models.schemas import CompatibilityEdge, ComponentCard, LicenceEvidence


def _card(name):
    return ComponentCard(
        owner="o",
        repo=name,
        canonical_url=f"https://github.com/o/{name}",
        repository_id=abs(hash(name)) % 10000,
        licence=LicenceEvidence(commercial_use=True),
    )


def _edge(src, dst, conf=0.8):
    return CompatibilityEdge(
        source=src, destination=dst, output="text", input="text",
        interface="python", confidence=conf,
    )


def test_builds_chain_from_edges():
    cards = {f"o/{n}": _card(n) for n in ("a", "b", "c")}
    edges = [_edge("o/a", "o/b"), _edge("o/b", "o/c")]
    combos = build_combinations(cards, edges)
    sets = [frozenset(c.components) for c in combos]
    assert frozenset({"o/a", "o/b"}) in sets
    assert frozenset({"o/a", "o/b", "o/c"}) in sets


def test_combinations_are_deduplicated():
    cards = {f"o/{n}": _card(n) for n in ("a", "b")}
    edges = [_edge("o/a", "o/b"), _edge("o/b", "o/a")]
    combos = build_combinations(cards, edges)
    keys = [frozenset(c.components) for c in combos]
    assert len(keys) == len(set(keys))  # no duplicate component sets


def test_respects_max_length():
    names = [chr(ord("a") + i) for i in range(7)]
    cards = {f"o/{n}": _card(n) for n in names}
    edges = [_edge(f"o/{names[i]}", f"o/{names[i+1]}") for i in range(len(names) - 1)]
    combos = build_combinations(cards, edges, max_len=5)
    assert all(2 <= len(c.components) <= 5 for c in combos)


def test_combo_id_is_stable_regardless_of_order():
    cards = {f"o/{n}": _card(n) for n in ("a", "b")}
    c1 = build_combinations(cards, [_edge("o/a", "o/b")])[0]
    c2 = build_combinations(cards, [_edge("o/b", "o/a")])[0]
    assert c1.combo_id == c2.combo_id  # same component set -> same id
