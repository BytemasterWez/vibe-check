from app.matching.edges import build_edge, build_edges, normalise
from app.models.schemas import ComponentCard, LicenceEvidence, Role


def _card(name, inputs, outputs, interfaces, roles):
    return ComponentCard(
        owner="o",
        repo=name,
        canonical_url=f"https://github.com/o/{name}",
        repository_id=hash(name) % 10000,
        inputs=inputs,
        outputs=outputs,
        interfaces=interfaces,
        roles=roles,
        licence=LicenceEvidence(commercial_use=True),
    )


def test_normalise_maps_synonyms():
    assert normalise("Plain Text") == "text"
    assert normalise("PDF") == "document"
    assert normalise("vector") == "embedding"


def test_edge_created_when_output_matches_input():
    a = _card("a", [], ["text"], ["python"], [Role.parser])
    b = _card("b", ["text"], ["json"], ["python"], [Role.classifier])
    edge = build_edge(a, b)
    assert edge is not None
    assert edge.output == "text"
    assert edge.confidence >= 0.4
    assert edge.evidence


def test_no_edge_when_nothing_connects():
    a = _card("a", [], ["image"], [], [Role.parser])
    b = _card("b", ["audio"], [], [], [Role.classifier])
    assert build_edge(a, b) is None


def test_adapter_required_when_only_interface_overlaps():
    a = _card("a", [], ["image"], ["python"], [Role.parser])
    b = _card("b", ["audio"], [], ["python"], [Role.classifier])
    edge = build_edge(a, b)
    assert edge is not None
    assert edge.required_adapter is not None


def test_build_edges_is_directional_and_skips_self():
    a = _card("a", [], ["text"], ["python"], [Role.parser])
    b = _card("b", ["text"], [], ["python"], [Role.classifier])
    edges = build_edges([a, b])
    pairs = {(e.source, e.destination) for e in edges}
    assert ("o/a", "o/a") not in pairs
    assert ("o/a", "o/b") in pairs
