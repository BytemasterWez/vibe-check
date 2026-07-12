"""Compatibility-edge construction: match one component's outputs to another's
inputs, record the interface/adapter, and evaluate licence + deployment
compatibility. Every edge records exactly why it is considered compatible.
"""

from __future__ import annotations

from app.models.schemas import CompatibilityEdge, ComponentCard

# Normalised data-shape vocabulary so free-text IO can be matched.
_SYNONYMS: dict[str, str] = {
    "text": "text",
    "plain text": "text",
    "string": "text",
    "document": "document",
    "documents": "document",
    "pdf": "document",
    "image": "image",
    "images": "image",
    "picture": "image",
    "json": "json",
    "structured data": "json",
    "embedding": "embedding",
    "embeddings": "embedding",
    "vector": "embedding",
    "audio": "audio",
    "speech": "audio",
    "table": "table",
    "csv": "table",
    "dataframe": "table",
}


def normalise(token: str) -> str:
    t = token.strip().lower()
    return _SYNONYMS.get(t, t)


def _interface_overlap(a: ComponentCard, b: ComponentCard) -> str | None:
    """A shared interface makes wiring plausible; python/cli/rest are universal."""
    shared = set(a.interfaces) & set(b.interfaces)
    for pref in ("python", "rest", "cli", "grpc", "graphql"):
        if pref in shared:
            return pref
    if a.interfaces and b.interfaces:
        return "adapter"
    return None


def _licence_compatible(a: ComponentCard, b: ComponentCard) -> bool | None:
    if a.licence.commercial_use is None or b.licence.commercial_use is None:
        return None
    return bool(a.licence.commercially_safe and b.licence.commercially_safe)


def _deployment_compatible(a: ComponentCard, b: ComponentCard) -> bool | None:
    """Can the two components co-deploy on one host?

    Unknown OS/GPU facts stay ``None`` (unknown), never an assumed pass. A
    concrete OS conflict (disjoint non-empty supported_os sets) is a fail;
    otherwise, when the facts we have don't conflict, they are compatible.
    Affordability of any GPU requirement is judged separately by Gate 4.
    """
    os_a, os_b = set(a.deployment.supported_os), set(b.deployment.supported_os)
    if os_a and os_b and not (os_a & os_b):
        return False
    if a.deployment.gpu_required is None and b.deployment.gpu_required is None and not (
        os_a or os_b
    ):
        return None
    return True


def build_edge(src: ComponentCard, dst: ComponentCard) -> CompatibilityEdge | None:
    """Return an edge if ``src`` produces something ``dst`` can consume."""
    src_outputs = {normalise(o) for o in src.outputs}
    dst_inputs = {normalise(i) for i in dst.inputs}
    match = src_outputs & dst_inputs
    interface = _interface_overlap(src, dst)

    if not match and interface is None:
        return None

    matched_shape = next(iter(match)) if match else "unspecified"
    evidence: list[str] = []
    confidence = 0.0

    if match:
        evidence.append(
            f"{src.owner}/{src.repo} outputs '{matched_shape}' which "
            f"{dst.owner}/{dst.repo} accepts as input"
        )
        confidence += 0.5
    if interface and interface != "adapter":
        evidence.append(f"shared '{interface}' interface enables direct wiring")
        confidence += 0.3
    elif interface == "adapter":
        evidence.append("interfaces differ; a thin adapter is required")
        confidence += 0.1

    lic_ok = _licence_compatible(src, dst)
    dep_ok = _deployment_compatible(src, dst)

    direct = bool(match) and interface is not None and interface != "adapter"
    # An adapter is needed whenever data shapes don't line up, or the interfaces
    # differ — even a shared transport can't convert image bytes into audio.
    required_adapter = None if direct else "format/interface adapter"
    difficulty = "low" if direct else "medium"

    return CompatibilityEdge(
        source=f"{src.owner}/{src.repo}",
        destination=f"{dst.owner}/{dst.repo}",
        output=matched_shape,
        input=matched_shape,
        interface=interface or "adapter",
        conversion_method=None if not required_adapter else "adapter",
        confidence=round(min(1.0, confidence), 3),
        required_adapter=required_adapter,
        integration_difficulty=difficulty,
        licence_compatible=lic_ok,
        deployment_compatible=dep_ok,
        evidence=evidence,
    )


def build_edges(cards: list[ComponentCard]) -> list[CompatibilityEdge]:
    edges: list[CompatibilityEdge] = []
    for src in cards:
        for dst in cards:
            if src is dst:
                continue
            edge = build_edge(src, dst)
            if edge is not None:
                edges.append(edge)
    return edges
