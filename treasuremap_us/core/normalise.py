"""Entity-name normalisation and claimant-type classification."""

import re
from functools import lru_cache
from pathlib import Path

import yaml

from . import CONFIG_DIR

# Suffix canonicalisation applied after uppercasing/punctuation stripping.
_SUFFIX_MAP = {
    "LLC": "LLC", "LC": "LLC",
    "INCORPORATED": "INC", "INC": "INC",
    "CORPORATION": "CORP", "CORP": "CORP",
    "COMPANY": "CO", "CO": "CO",
    "LIMITED": "LTD", "LTD": "LTD",
    "LP": "LP", "LLP": "LLP", "PLLC": "PLLC", "PC": "PC",
}
_NOISE_WORDS = {"THE", "OF", "AND", "&"}


@lru_cache
def _terms() -> dict:
    with open(CONFIG_DIR / "search_terms.yaml", encoding="utf-8") as fh:
        return yaml.safe_load(fh)


def normalise_name(name: str) -> str:
    """Uppercase, strip punctuation/noise, canonicalise suffixes.
    'The Acme Widget Co., Inc.' -> 'ACME WIDGET CO INC'"""
    text = re.sub(r"[^\w\s]", " ", (name or "").upper())
    tokens = [t for t in text.split() if t not in _NOISE_WORDS]
    return " ".join(_SUFFIX_MAP.get(t, t) for t in tokens)


def classify_claimant(name: str) -> str:
    """Return 'business', 'individual', or 'unknown'.
    PHASE 1 ingests 'business' only; 'unknown' goes to manual review, never
    to outreach."""
    upper = f" {normalise_name(name)} "
    terms = _terms()
    for marker in terms.get("individual_markers", []):
        if f" {normalise_name(marker)} " in upper:
            return "individual"
    for suffix in terms.get("business_suffixes", []):
        norm = normalise_name(suffix)
        if upper.rstrip().endswith(f" {norm}") or f" {norm} " in upper:
            return "business"
    # Government units are entity claimants too.
    for gov in ("CITY", "COUNTY", "STATE", "DEPARTMENT", "TREASURER",
                "IRS", "AUTHORITY", "DISTRICT", "COMMISSION"):
        if f" {gov} " in upper:
            return "business"
    return "unknown"


def name_similarity(a: str, b: str) -> float:
    """Cheap token-Jaccard similarity on normalised names (0..1)."""
    ta, tb = set(normalise_name(a).split()), set(normalise_name(b).split())
    if not ta or not tb:
        return 0.0
    return len(ta & tb) / len(ta | tb)
