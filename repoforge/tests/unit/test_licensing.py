from app.licensing.policy import classify, combination_licence_ok
from app.models.schemas import LicenceClass


def test_mit_is_permissive_commercial():
    ev = classify("MIT")
    assert ev.licence_class is LicenceClass.permissive_commercial
    assert ev.commercial_use is True
    assert ev.commercially_safe is True


def test_agpl_is_strong_copyleft_with_network_clause():
    ev = classify("AGPL-3.0")
    assert ev.licence_class is LicenceClass.strong_copyleft
    assert ev.commercial_use is False
    assert ev.network_copyleft is True
    assert ev.commercially_safe is False


def test_unknown_licence_never_marked_safe():
    for spdx in [None, "", "NOASSERTION", "OTHER"]:
        ev = classify(spdx)
        assert ev.licence_class is LicenceClass.unknown
        assert ev.commercial_use is None
        assert ev.commercially_safe is False


def test_unrecognised_spdx_stays_unknown():
    ev = classify("SOME-NEW-LICENCE-9000")
    assert ev.licence_class is LicenceClass.unknown
    assert ev.commercial_use is None


def test_non_commercial_licence_is_not_safe():
    ev = classify("CC-BY-NC-4.0")
    assert ev.licence_class is LicenceClass.non_commercial
    assert ev.commercially_safe is False


def test_text_hash_recorded_when_text_supplied():
    ev = classify("MIT", licence_text="Permission is hereby granted...")
    assert ev.text_sha256 is not None
    assert len(ev.text_sha256) == 64


def test_changed_licence_detection_via_hash():
    a = classify("MIT", licence_text="text v1")
    b = classify("MIT", licence_text="text v2")
    assert a.text_sha256 != b.text_sha256  # a licence text change is detectable


def test_combination_requires_all_components_safe():
    assert combination_licence_ok([classify("MIT"), classify("Apache-2.0")]) is True
    assert combination_licence_ok([classify("MIT"), classify("GPL-3.0")]) is False
    assert combination_licence_ok([classify("MIT"), classify(None)]) is False
    assert combination_licence_ok([]) is False
