import json

from app.dossiers.generator import build_dossier_dict, render_markdown, write_dossier
from app.models.schemas import (
    Combination,
    CompatibilityEdge,
    ComponentCard,
    GateResult,
    GateState,
    LicenceEvidence,
    ScoredCombination,
)


def _cards():
    return {
        "o/a": ComponentCard(
            owner="o", repo="a", canonical_url="https://github.com/o/a",
            repository_id=1, commit_sha="abc123",
            licence=LicenceEvidence(spdx_id="MIT", commercial_use=True),
        ),
        "o/b": ComponentCard(
            owner="o", repo="b", canonical_url="https://github.com/o/b",
            repository_id=2, commit_sha="def456",
            licence=LicenceEvidence(spdx_id="Apache-2.0", commercial_use=True),
        ),
    }


def _scored():
    combo = Combination(
        combo_id="cmb_test", components=["o/a", "o/b"],
        edges=[CompatibilityEdge(source="o/a", destination="o/b", output="text",
                                 input="text", interface="python", confidence=0.8,
                                 evidence=["a outputs text; b accepts text"])],
        product_name="DocPipeline",
        one_sentence="Structures documents to save manual entry.",
    )
    gates = [GateResult(gate=i, name=f"Gate {i}", state=GateState.PASS,
                        evidence=[f"ok {i}"]) for i in range(1, 11)]
    return ScoredCombination(combination=combo, gates=gates)


def test_dossier_dict_has_required_sections():
    d = build_dossier_dict(_scored(), _cards())
    for key in ("dossier_id", "generated_at", "components", "integration_flow",
                "gates", "chatgpt_analysis_block", "technical_opportunity_score",
                "disclaimer"):
        assert key in d
    assert d["is_ten_of_ten"] is True
    assert d["technical_opportunity_score"] == 10
    assert len(d["gates"]) == 10
    assert "commit_sha" in d["components"][0]
    # ChatGPT block asks for the required validation dimensions.
    block = d["chatgpt_analysis_block"].lower()
    for needle in ("competitor", "buyer", "regulatory", "unit economics",
                   "14-day", "kill criteria", "commercial score"):
        assert needle in block


def test_markdown_renders_and_escapes_disclaimer():
    md = render_markdown(build_dossier_dict(_scored(), _cards()))
    assert "# RepoForge Dossier" in md
    assert "technical-opportunity score" in md
    assert "NOT a commercially" in md


def test_write_dossier_creates_both_files(tmp_path):
    json_path, md_path = write_dossier(_scored(), _cards(), str(tmp_path))
    assert json_path.endswith(".json")
    assert md_path.endswith(".md")
    data = json.loads(open(json_path).read())
    assert data["dossier_id"] == "dossier_test"
    assert open(md_path).read().startswith("# RepoForge Dossier")
