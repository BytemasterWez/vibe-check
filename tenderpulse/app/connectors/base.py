"""Shared OCDS release-package pagination: both UK sources use links.next cursors."""
import logging
from collections.abc import Iterator

from .. import config
from ..utils.http import get_json

log = logging.getLogger("tenderpulse.connectors")


def iter_releases(start_url: str, params: dict, max_pages: int | None = None) -> Iterator[dict]:
    """Yield OCDS releases across pages, following links.next until exhausted."""
    max_pages = max_pages or config.MAX_PAGES_PER_RUN
    url: str | None = start_url
    page = 0
    while url and page < max_pages:
        package = get_json(url, params=params if page == 0 else None)
        releases = package.get("releases") or []
        log.info("page %s: %s releases", page + 1, len(releases))
        yield from releases
        page += 1
        next_link = (package.get("links") or {}).get("next")
        if not releases or not next_link or next_link == url:
            break
        url = next_link


class Connector:
    """Interface each source implements."""

    name: str = ""

    def fetch(self, since_iso: str, until_iso: str, max_pages: int | None = None) -> Iterator[dict]:
        raise NotImplementedError

    def notice_url(self, release: dict) -> str:
        raise NotImplementedError
