"""Deterministic licence classification.

Rule: never mark an unknown licence as commercially safe. When the SPDX id is
missing, ambiguous or conflicting, `commercial_use` stays ``None`` (unknown) and
the licence class is ``unknown``/``conflicting`` — never a safe class.
"""

from __future__ import annotations

import hashlib

from app.models.schemas import LicenceClass, LicenceEvidence

# SPDX id (upper-cased) -> (class, commercial_use, network_copyleft)
_SPDX_MAP: dict[str, tuple[LicenceClass, bool, bool]] = {
    "MIT": (LicenceClass.permissive_commercial, True, False),
    "APACHE-2.0": (LicenceClass.permissive_commercial, True, False),
    "BSD-2-CLAUSE": (LicenceClass.permissive_commercial, True, False),
    "BSD-3-CLAUSE": (LicenceClass.permissive_commercial, True, False),
    "ISC": (LicenceClass.permissive_commercial, True, False),
    "0BSD": (LicenceClass.permissive_commercial, True, False),
    "UNLICENSE": (LicenceClass.permissive_commercial, True, False),
    "ZLIB": (LicenceClass.permissive_commercial, True, False),
    "PYTHON-2.0": (LicenceClass.permissive_commercial, True, False),
    # Weak copyleft — commercial with conditions
    "MPL-2.0": (LicenceClass.conditional_commercial, True, False),
    "LGPL-2.1": (LicenceClass.conditional_commercial, True, False),
    "LGPL-3.0": (LicenceClass.conditional_commercial, True, False),
    "EPL-2.0": (LicenceClass.conditional_commercial, True, False),
    "APACHE-2.0-WITH-LLVM-EXCEPTION": (LicenceClass.conditional_commercial, True, False),
    # Strong copyleft — usable but heavy obligations; NOT auto-safe for packaging
    "GPL-2.0": (LicenceClass.strong_copyleft, False, False),
    "GPL-3.0": (LicenceClass.strong_copyleft, False, False),
    "AGPL-3.0": (LicenceClass.strong_copyleft, False, True),
    # Source-available / non-open-source
    "BSL-1.1": (LicenceClass.source_available, False, False),
    "BUSL-1.1": (LicenceClass.source_available, False, False),
    "SSPL-1.0": (LicenceClass.source_available, False, True),
    "ELASTIC-2.0": (LicenceClass.source_available, False, False),
    # Non-commercial
    "CC-BY-NC-4.0": (LicenceClass.non_commercial, False, False),
    "CC-BY-NC-SA-4.0": (LicenceClass.non_commercial, False, False),
}

_REQUIRED_NOTICES: dict[LicenceClass, list[str]] = {
    LicenceClass.permissive_commercial: ["Include copyright + licence text in distribution"],
    LicenceClass.conditional_commercial: [
        "Include licence text",
        "Disclose source of modified covered files",
    ],
    LicenceClass.strong_copyleft: [
        "Derivative works must be licensed under the same terms",
        "Source disclosure required on distribution",
    ],
}


def classify(
    spdx_id: str | None,
    *,
    licence_file_url: str | None = None,
    licence_text: str | None = None,
    detection_method: str = "github_api",
) -> LicenceEvidence:
    """Classify from an SPDX id (as returned by the GitHub API `license.spdx_id`)."""
    ev = LicenceEvidence(
        spdx_id=spdx_id,
        licence_file_url=licence_file_url,
        detection_method=detection_method,
    )
    if licence_text:
        ev.text_sha256 = hashlib.sha256(licence_text.encode("utf-8", "replace")).hexdigest()

    if not spdx_id or spdx_id.upper() in {"NOASSERTION", "OTHER", ""}:
        # Unknown stays unknown. Do not guess commercial safety.
        ev.licence_class = LicenceClass.unknown
        ev.commercial_use = None
        ev.confidence = 0.0
        return ev

    key = spdx_id.upper()
    mapping = _SPDX_MAP.get(key)
    if mapping is None:
        ev.licence_class = LicenceClass.unknown
        ev.commercial_use = None
        ev.confidence = 0.2  # recognised as an id but not in our policy table
        return ev

    cls, commercial, network = mapping
    ev.licence_class = cls
    ev.commercial_use = commercial
    ev.network_copyleft = network
    ev.required_notices = list(_REQUIRED_NOTICES.get(cls, []))
    ev.confidence = 0.95 if detection_method == "github_api" else 0.7
    ev.redistribution_notes = (
        "Redistribution permitted under stated terms"
        if commercial
        else "Redistribution/commercial packaging restricted or requires review"
    )
    return ev


def combination_licence_ok(evidences: list[LicenceEvidence]) -> bool:
    """Gate 1 helper: every component must be commercially usable and known."""
    if not evidences:
        return False
    return all(e.commercially_safe for e in evidences)
