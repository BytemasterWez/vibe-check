"""Find a Tender OCDS API (above-threshold UK notices).

Live-verified 2026-07-09: HTTP 200, OCDS 1.1, cursor pagination via links.next,
date filters updatedFrom/updatedTo, no auth, Open Government Licence v3.
See docs/SOURCE_VALIDATION.md.
"""
from collections.abc import Iterator

from .. import config
from .base import Connector, iter_releases


class FindATenderConnector(Connector):
    name = "find_a_tender"

    def fetch(self, since_iso: str, until_iso: str, max_pages: int | None = None) -> Iterator[dict]:
        params = {
            "updatedFrom": since_iso,
            "updatedTo": until_iso,
            "stages": "tender",
            "limit": config.PAGE_SIZE,
        }
        yield from iter_releases(config.FIND_A_TENDER_BASE, params, max_pages)

    def notice_url(self, release: dict) -> str:
        rid = release.get("id") or ""
        return f"https://www.find-tender.service.gov.uk/Notice/{rid}" if rid else ""
