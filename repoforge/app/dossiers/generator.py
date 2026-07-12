"""Dossier generation for 10/10 combinations — Markdown and JSON.

The dossier is evidence-first: every gate decision, its evidence, contradictions
and unknowns are recorded, alongside a copy-and-paste ChatGPT analysis block for
downstream commercial validation.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime

from app.models.schemas import ComponentCard, ScoredCombination


def _dossier_id(scored: ScoredCombination) -> str:
    return "dossier_" + scored.combination.combo_id.removeprefix("cmb_")


def build_dossier_dict(
    scored: ScoredCombination, cards: dict[str, ComponentCard]
) -> dict:
    combo = scored.combination
    comp_cards = [cards[c] for c in combo.components if c in cards]
    now = datetime.now(UTC).isoformat()

    components = []
    for c in comp_cards:
        components.append(
            {
                "name": f"{c.owner}/{c.repo}",
                "github": c.canonical_url,
                "commit_sha": c.commit_sha,
                "release": c.release,
                "roles": [r.value for r in c.roles],
                "licence": {
                    "spdx_id": c.licence.spdx_id,
                    "class": c.licence.licence_class.value,
                    "commercial_use": c.licence.commercial_use,
                    "file_url": c.licence.licence_file_url,
                    "text_sha256": c.licence.text_sha256,
                },
                "deployment": c.deployment.model_dump(),
                "maturity_score": c.maturity_score,
                "evidence_urls": c.evidence_urls,
            }
        )

    gates = [
        {
            "gate": g.gate,
            "name": g.name,
            "state": g.state.value,
            "evidence": g.evidence,
            "contradictions": g.contradictions,
            "unknowns": g.unknowns,
        }
        for g in scored.gates
    ]

    return {
        "dossier_id": _dossier_id(scored),
        "generated_at": now,
        "product_name": combo.product_name or "Unnamed RepoForge candidate",
        "one_sentence": combo.one_sentence,
        "problem_hypothesis": combo.one_sentence or "TBD — to be validated",
        "buyer_hypothesis": "Hypothesis — validate downstream",
        "technical_opportunity_score": scored.technical_opportunity_score,
        "is_ten_of_ten": scored.is_ten_of_ten,
        "components": components,
        "integration_flow": [
            {
                "from": e.source,
                "to": e.destination,
                "output": e.output,
                "input": e.input,
                "interface": e.interface,
                "required_adapter": e.required_adapter,
                "difficulty": e.integration_difficulty,
                "confidence": e.confidence,
                "evidence": e.evidence,
            }
            for e in combo.edges
        ],
        "gates": gates,
        "important_unknowns": [u for g in scored.gates for u in g.unknowns],
        "contradictory_evidence": [c for g in scored.gates for c in g.contradictions],
        "chatgpt_analysis_block": _chatgpt_block(combo.product_name, components),
        "disclaimer": (
            "This is a RepoForge technical-opportunity score, NOT a commercially "
            "validated business. UNKNOWN gates are never counted as PASS."
        ),
    }


def _chatgpt_block(product_name: str | None, components: list[dict]) -> str:
    names = ", ".join(c["name"] for c in components)
    return (
        f"You are a skeptical commercial due-diligence analyst. Evaluate this "
        f"proposed product: '{product_name or 'candidate'}', built by combining "
        f"these open-source GitHub components: {names}. Provide:\n"
        "1. Current competitor validation (name real competitors and gaps).\n"
        "2. Buyer and budget-holder validation (who pays, from which budget).\n"
        "3. Substitute / manual-workflow analysis.\n"
        "4. Regulatory analysis.\n"
        "5. Unit economics (COGS, pricing, margin).\n"
        "6. Market evidence (size, demand signals, cite sources).\n"
        "7. A concrete 14-day proof plan.\n"
        "8. A 30/60/90-day plan.\n"
        "9. Explicit kill criteria.\n"
        "10. A final commercial score out of 10 with justification.\n"
        "Challenge every optimistic assumption. Treat all component capability "
        "claims as unverified until you check them."
    )


def render_markdown(dossier: dict) -> str:
    lines: list[str] = []
    lines.append(f"# RepoForge Dossier — {dossier['product_name']}")
    lines.append("")
    lines.append(f"- **Dossier ID:** {dossier['dossier_id']}")
    lines.append(f"- **Generated:** {dossier['generated_at']}")
    lines.append(
        f"- **Technical-opportunity score:** "
        f"{dossier['technical_opportunity_score']}/10 "
        f"({'10/10' if dossier['is_ten_of_ten'] else 'not 10/10'})"
    )
    lines.append("")
    lines.append(f"> {dossier['disclaimer']}")
    lines.append("")
    if dossier.get("one_sentence"):
        lines.append(f"**One sentence:** {dossier['one_sentence']}")
        lines.append("")

    lines.append("## Components")
    for c in dossier["components"]:
        lines.append(f"### {c['name']}")
        lines.append(f"- GitHub: {c['github']}")
        lines.append(f"- Commit: `{c['commit_sha'] or 'unknown'}`  Release: {c['release'] or '—'}")
        lines.append(f"- Roles: {', '.join(c['roles']) or '—'}")
        lic = c["licence"]
        lines.append(
            f"- Licence: {lic['spdx_id'] or 'unknown'} "
            f"({lic['class']}, commercial_use={lic['commercial_use']})"
        )
        lines.append("")

    lines.append("## Integration flow")
    for e in dossier["integration_flow"]:
        lines.append(
            f"- `{e['from']}` → `{e['to']}` via **{e['interface']}** "
            f"({e['output']}→{e['input']}, confidence {e['confidence']}, "
            f"difficulty {e['difficulty']})"
        )
        for ev in e["evidence"]:
            lines.append(f"    - {ev}")
    lines.append("")

    lines.append("## Ten gate decisions")
    for g in dossier["gates"]:
        lines.append(f"### Gate {g['gate']} — {g['name']}: **{g['state']}**")
        for ev in g["evidence"]:
            lines.append(f"- ✅ {ev}")
        for co in g["contradictions"]:
            lines.append(f"- ❌ {co}")
        for u in g["unknowns"]:
            lines.append(f"- ❓ {u}")
        lines.append("")

    lines.append("## Copy-and-paste ChatGPT analysis block")
    lines.append("```")
    lines.append(dossier["chatgpt_analysis_block"])
    lines.append("```")
    lines.append("")
    return "\n".join(lines)


def write_dossier(
    scored: ScoredCombination,
    cards: dict[str, ComponentCard],
    out_dir: str,
) -> tuple[str, str]:
    """Write both JSON and Markdown dossiers; return (json_path, md_path)."""
    import os

    dossier = build_dossier_dict(scored, cards)
    os.makedirs(out_dir, exist_ok=True)
    base = os.path.join(out_dir, dossier["dossier_id"])
    json_path = base + ".json"
    md_path = base + ".md"
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(dossier, f, indent=2, default=str)
    with open(md_path, "w", encoding="utf-8") as f:
        f.write(render_markdown(dossier))
    return json_path, md_path
