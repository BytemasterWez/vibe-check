"""County join hierarchy. The county FIPS join is explicit and auditable:
every join returns the method that produced it, and only deterministic
methods (the first five) may enter norm.* automatically. Fuzzy candidates
are quarantined for human review — never authoritative.

Join hierarchy (in order):
  1. Exact county FIPS               -> MATCH_EXACT_FIPS
  2. Exact state FIPS + county FIPS  -> MATCH_EXACT_FIPS
  3. Official GEOID                  -> MATCH_EXACT_GEOID
  4. Official crosswalk table        -> MATCH_CROSSWALK
  5. State + county name exact match -> MATCH_EXACT_NAME
  6. State + county alias match      -> MATCH_ALIAS
  7. Fuzzy candidate only            -> MATCH_CANDIDATE_FUZZY (quarantine)
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from difflib import SequenceMatcher
from typing import Optional

MATCH_EXACT_FIPS = "MATCH_EXACT_FIPS"
MATCH_EXACT_GEOID = "MATCH_EXACT_GEOID"
MATCH_CROSSWALK = "MATCH_CROSSWALK"
MATCH_EXACT_NAME = "MATCH_EXACT_NAME"
MATCH_ALIAS = "MATCH_ALIAS"
MATCH_CANDIDATE_FUZZY = "MATCH_CANDIDATE_FUZZY"
NO_MATCH = "NO_MATCH"

# Only these enter norm.* automatically (design rule: alias is deterministic
# because aliases are curated rows in ref.geography_aliases).
AUTHORITATIVE_METHODS = frozenset(
    {MATCH_EXACT_FIPS, MATCH_EXACT_GEOID, MATCH_CROSSWALK, MATCH_EXACT_NAME, MATCH_ALIAS}
)

_FIPS_RE = re.compile(r"^\d{5}$")
_STATE_FIPS_RE = re.compile(r"^\d{2}$")

# Suffixes stripped when normalising county names for comparison.
_NAME_SUFFIXES = (
    " county",
    " parish",
    " borough",
    " census area",
    " city and borough",
    " municipality",
    " planning region",
    " city",   # keep last: independent cities compare on bare name + type
)


def valid_county_fips(value: str | None) -> bool:
    return bool(value) and bool(_FIPS_RE.match(str(value)))


def normalise_name(name: str) -> str:
    """Lower-case, strip punctuation/diacritic variants and legal suffixes."""
    n = name.strip().lower()
    n = n.replace(".", "").replace("'", "").replace("ñ", "n").replace("ó", "o")
    n = re.sub(r"\bsaint\b", "st", n)
    n = re.sub(r"\bste\b", "st", n)
    n = re.sub(r"\s+", " ", n)
    for suffix in _NAME_SUFFIXES:
        if n.endswith(suffix):
            n = n[: -len(suffix)]
            break
    return n.strip()


@dataclass
class JoinResult:
    county_fips: Optional[str]
    method: str
    input_geography: dict
    candidate_score: float | None = None

    @property
    def authoritative(self) -> bool:
        return self.method in AUTHORITATIVE_METHODS


@dataclass
class CountyIndex:
    """In-memory index over ref.counties (+aliases +crosswalks) for joining.

    Built once per run from the database (or from fixtures in tests).
    """

    fips: set[str] = field(default_factory=set)
    by_state_name: dict[tuple[str, str], str] = field(default_factory=dict)
    by_state_alias: dict[tuple[str, str], str] = field(default_factory=dict)
    crosswalk: dict[str, str] = field(default_factory=dict)  # old_fips -> new_fips
    state_abbr_to_fips: dict[str, str] = field(default_factory=dict)
    state_name_to_fips: dict[str, str] = field(default_factory=dict)
    names_by_state: dict[str, list[tuple[str, str]]] = field(default_factory=dict)

    @classmethod
    def build(
        cls,
        counties: list[dict],
        aliases: list[dict] | None = None,
        crosswalks: list[dict] | None = None,
    ) -> "CountyIndex":
        idx = cls()
        for c in counties:
            fips = str(c["county_fips"]).zfill(5)
            idx.fips.add(fips)
            state_fips = str(c["state_fips"]).zfill(2)
            name_key = normalise_name(c["county_name"])
            idx.by_state_name[(state_fips, name_key)] = fips
            # equivalent name too ("St. Tammany Parish")
            idx.by_state_name.setdefault(
                (state_fips, normalise_name(c.get("county_equivalent_name") or c["county_name"])),
                fips,
            )
            idx.names_by_state.setdefault(state_fips, []).append((name_key, fips))
            abbr = str(c.get("state_abbr", "")).upper()
            if abbr:
                idx.state_abbr_to_fips[abbr] = state_fips
            sname = str(c.get("state_name", "")).lower()
            if sname:
                idx.state_name_to_fips[sname] = state_fips
        for a in aliases or []:
            fips = str(a["county_fips"]).zfill(5)
            state_fips = fips[:2]
            idx.by_state_alias[(state_fips, normalise_name(a["alias_name"]))] = fips
        for x in crosswalks or []:
            idx.crosswalk[str(x["old_fips"]).zfill(5)] = str(x["new_fips"]).zfill(5)
        return idx

    def resolve_state(self, state: str | None) -> Optional[str]:
        if not state:
            return None
        s = str(state).strip()
        if _STATE_FIPS_RE.match(s):
            return s
        if s.upper() in self.state_abbr_to_fips:
            return self.state_abbr_to_fips[s.upper()]
        return self.state_name_to_fips.get(s.lower())


def join_county(
    index: CountyIndex,
    *,
    county_fips: str | None = None,
    state_fips: str | None = None,
    county_fips_part: str | None = None,
    geoid: str | None = None,
    state: str | None = None,
    county_name: str | None = None,
    fuzzy_threshold: float = 0.70,
) -> JoinResult:
    """Resolve arbitrary source geography to a canonical county FIPS.

    Applies the join hierarchy in order and reports the method used.
    """
    input_geography = {
        "county_fips": county_fips,
        "state_fips": state_fips,
        "county_fips_part": county_fips_part,
        "geoid": geoid,
        "state": state,
        "county_name": county_name,
    }

    # 1. Exact county FIPS
    if county_fips:
        f = str(county_fips).strip().zfill(5)
        if valid_county_fips(f) and f in index.fips:
            return JoinResult(f, MATCH_EXACT_FIPS, input_geography)
        # 4. crosswalk on a stale-but-official FIPS
        if f in index.crosswalk:
            return JoinResult(index.crosswalk[f], MATCH_CROSSWALK, input_geography)

    # 2. state FIPS + 3-digit county part
    if state_fips and county_fips_part:
        f = str(state_fips).strip().zfill(2) + str(county_fips_part).strip().zfill(3)
        if f in index.fips:
            return JoinResult(f, MATCH_EXACT_FIPS, input_geography)
        if f in index.crosswalk:
            return JoinResult(index.crosswalk[f], MATCH_CROSSWALK, input_geography)

    # 3. Official GEOID (e.g. '0500000US22103' or plain '22103')
    if geoid:
        g = str(geoid).strip()
        if "US" in g:
            g = g.split("US")[-1]
        if valid_county_fips(g) and g in index.fips:
            return JoinResult(g, MATCH_EXACT_GEOID, input_geography)
        if g in index.crosswalk:
            return JoinResult(index.crosswalk[g], MATCH_CROSSWALK, input_geography)

    # 5/6/7. Name-based joins need a resolvable state.
    resolved_state = index.resolve_state(state) or (
        str(state_fips).zfill(2) if state_fips else None
    )
    if resolved_state and county_name:
        key = (resolved_state, normalise_name(county_name))
        if key in index.by_state_name:
            return JoinResult(index.by_state_name[key], MATCH_EXACT_NAME, input_geography)
        if key in index.by_state_alias:
            return JoinResult(index.by_state_alias[key], MATCH_ALIAS, input_geography)

        # 7. Fuzzy candidate — NEVER authoritative, always quarantined.
        best_fips, best_score = None, 0.0
        for name_key, fips in index.names_by_state.get(resolved_state, []):
            score = SequenceMatcher(None, key[1], name_key).ratio()
            if score > best_score:
                best_fips, best_score = fips, score
        if best_fips and best_score >= fuzzy_threshold:
            return JoinResult(
                best_fips, MATCH_CANDIDATE_FUZZY, input_geography, candidate_score=best_score
            )

    return JoinResult(None, NO_MATCH, input_geography)


def join_quality_report(results: list[JoinResult]) -> dict:
    """Aggregate join outcomes for audit.join_quality."""
    by_method: dict[str, int] = {}
    for r in results:
        by_method[r.method] = by_method.get(r.method, 0) + 1
    matched = sum(v for k, v in by_method.items() if k in AUTHORITATIVE_METHODS)
    total = len(results)
    unmatched_sample = [
        r.input_geography for r in results if not r.authoritative
    ][:20]
    return {
        "total_records": total,
        "matched": matched,
        "match_rate": (matched / total) if total else 0.0,
        "by_confidence": by_method,
        "unmatched_sample": unmatched_sample,
    }
