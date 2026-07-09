from datetime import datetime, timedelta

from app.models import Notice, Profile
from app.scoring.engine import score_notice

NOW = datetime(2026, 7, 9, 12, 0, 0)


def make_notice(**overrides) -> Notice:
    defaults = dict(
        source_name="contracts_finder",
        ocid="ocds-x-1",
        title="Web development framework for council services",
        description="Digital transformation of citizen services",
        cpv_codes=["72000000"],
        regions=["Yorkshire and the Humber"],
        value_amount=80000.0,
        sme_suitable=True,
        deadline_date=NOW + timedelta(days=20),
        notice_type="tender",
    )
    defaults.update(overrides)
    return Notice(**defaults)


def make_profile(**overrides) -> Profile:
    defaults = dict(
        name="digital agency",
        keywords=["web development", "digital"],
        cpv_prefixes=["72"],
        regions=["Yorkshire"],
        min_value=10000,
        max_value=500000,
        require_sme=False,
        min_days_to_deadline=5,
    )
    defaults.update(overrides)
    return Profile(**defaults)


def test_strong_match_scores_high_with_reasons():
    score, reasons = score_notice(make_notice(), make_profile(), now=NOW)
    assert score >= 80
    assert any("CPV" in r for r in reasons)
    assert any("keyword" in r for r in reasons)
    assert any("region" in r for r in reasons)


def test_passed_deadline_scores_zero():
    notice = make_notice(deadline_date=NOW - timedelta(days=1))
    score, reasons = score_notice(notice, make_profile(), now=NOW)
    assert score == 0
    assert reasons == ["deadline has passed"]


def test_too_little_runway_scores_zero():
    notice = make_notice(deadline_date=NOW + timedelta(days=2))
    score, _ = score_notice(notice, make_profile(min_days_to_deadline=10), now=NOW)
    assert score == 0


def test_no_cpv_or_keyword_match_scores_low():
    notice = make_notice(
        title="Grounds maintenance", description="Grass cutting",
        cpv_codes=["77314000"],
    )
    score, _ = score_notice(notice, make_profile(), now=NOW)
    assert score < 40


def test_sme_requirement_excludes_flagged_unsuitable():
    notice = make_notice(sme_suitable=False)
    score, reasons = score_notice(notice, make_profile(require_sme=True), now=NOW)
    assert score == 0
    assert "SME" in reasons[0]


def test_unknown_value_and_region_not_penalised_to_zero():
    notice = make_notice(value_amount=None, value_max=None, regions=[])
    score, reasons = score_notice(notice, make_profile(), now=NOW)
    assert score > 50
    assert any("unknown" in r for r in reasons)


def test_score_capped_at_100():
    profile = make_profile(keywords=["web", "development", "digital", "council", "services"])
    score, _ = score_notice(make_notice(), profile, now=NOW)
    assert score <= 100


def test_keyword_respects_word_boundaries():
    notice = make_notice(
        title="Insulin Infusion Pumps procurement",
        description="Continuous glucose monitoring",
        cpv_codes=["33100000"], regions=[],
    )
    profile = make_profile(keywords=["IT"], cpv_prefixes=[], regions=[])
    _, reasons = score_notice(notice, profile, now=NOW)
    assert not any("keyword" in r for r in reasons)
