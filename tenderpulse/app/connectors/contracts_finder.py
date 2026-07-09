"""Contracts Finder OCDS search API (below-threshold UK notices).

Live-verified 2026-07-09: HTTP 200, OCDS 1.1, cursor pagination via links.next,
date filters publishedFrom/publishedTo (local ISO, no zone suffix), no auth,
Open Government Licence v3. See docs/SOURCE_VALIDATION.md.
"""
from collections.abc import Iterator

from .. import config
from .base import Connector, iter_releases


class ContractsFinderConnector(Connector):
    name = "contracts_finder"

    def fetch(self, since_iso: str, until_iso: str, max_pages: int | None = None) -> Iterator[dict]:
        params = {
            "publishedFrom": since_iso,
            "publishedTo": until_iso,
            "stages": "tender",
            "limit": config.PAGE_SIZE,
        }
        yield from iter_releases(config.CONTRACTS_FINDER_BASE, params, max_pages)

    def notice_url(self, release: dict) -> str:
        docs = (release.get("tender") or {}).get("documents") or []
        for doc in docs:
            if doc.get("documentType") == "tenderNotice" and doc.get("url"):
                return doc["url"]
        for doc in docs:
            if doc.get("url"):
                return doc["url"]
        return ""
