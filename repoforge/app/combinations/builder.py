"""Staged combination construction with beam search.

We never enumerate the full power set. Instead: pre-filter deployable/licensed
components, seed chains from high-confidence edges, extend greedily under a beam
width, cap chain length at 2-5, and deduplicate by component set.
"""

from __future__ import annotations

import hashlib

from app.models.schemas import Combination, CompatibilityEdge, ComponentCard


def _combo_id(components: list[str]) -> str:
    key = "|".join(sorted(components))
    return "cmb_" + hashlib.sha256(key.encode()).hexdigest()[:16]


def _dedup_key(components: list[str]) -> frozenset[str]:
    return frozenset(components)


def build_combinations(
    cards: dict[str, ComponentCard],
    edges: list[CompatibilityEdge],
    *,
    beam_width: int = 8,
    max_len: int = 5,
    min_len: int = 2,
) -> list[Combination]:
    """Constrained beam search producing deduplicated 2-5 component chains."""
    adj: dict[str, list[CompatibilityEdge]] = {}
    for e in edges:
        adj.setdefault(e.source, []).append(e)

    # Seed beams from the strongest edges.
    seeds = sorted(edges, key=lambda e: e.confidence, reverse=True)[: beam_width * 2]
    beams: list[tuple[list[str], list[CompatibilityEdge]]] = []
    seen_seed: set[frozenset[str]] = set()
    for e in seeds:
        key = frozenset({e.source, e.destination})
        if key in seen_seed:
            continue
        seen_seed.add(key)
        beams.append(([e.source, e.destination], [e]))

    completed: dict[frozenset[str], Combination] = {}

    def record(chain: list[str], chain_edges: list[CompatibilityEdge]) -> None:
        if not (min_len <= len(chain) <= max_len):
            return
        key = _dedup_key(chain)
        if key in completed:
            return
        completed[key] = Combination(
            combo_id=_combo_id(chain),
            components=chain,
            edges=list(chain_edges),
        )

    for chain, chain_edges in beams:
        record(chain, chain_edges)

    # Extend beams up to max_len.
    for _ in range(max_len - min_len):
        extended: list[tuple[list[str], list[CompatibilityEdge], float]] = []
        for chain, chain_edges in beams:
            tail = chain[-1]
            for e in adj.get(tail, []):
                if e.destination in chain:
                    continue
                new_chain = chain + [e.destination]
                new_edges = chain_edges + [e]
                score = sum(x.confidence for x in new_edges) / len(new_edges)
                extended.append((new_chain, new_edges, score))
        if not extended:
            break
        extended.sort(key=lambda t: t[2], reverse=True)
        beams = [(c, e) for c, e, _ in extended[:beam_width]]
        for chain, chain_edges in beams:
            record(chain, chain_edges)

    return list(completed.values())
