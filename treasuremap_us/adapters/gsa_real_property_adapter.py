"""GSA surplus federal real property (realestatesales.gov /
disposal.gsa.gov).

Access model (research, pending programmatic verification):
  - disposal.gsa.gov is a Salesforce Experience Cloud site (/s/ paths);
    server-rendered HTML is thin and listing data loads via the site's own
    aura endpoints. Using those endpoints requires a ToS check first —
    until then the expected best status is VERIFIED_HTML_INDEX (public
    listing index pages) or VERIFIED_BROWSER_SESSION.
  - GSA's open-data programme (api.gsa.gov, api.data.gov keys) has a
    verified-API precedent (GSA Auctions API) but it covers PERSONAL
    property; real-property coverage must be confirmed. See the separate
    `gsa_auctions_api` registry entry.
"""

import hashlib
import re
from datetime import datetime, timezone

from core.registry import effective_status

from .base import BaseAdapter


class GSARealPropertyAdapter(BaseAdapter):
    source_id = "gsa_real_property"

    def looks_valid(self, result) -> bool:
        text = result.text.lower()
        return any(k in text for k in ("real property", "property", "auction",
                                       "disposition")) and len(result.body) > 500

    def parse_listing_links(self, html: str) -> list[str]:
        """Extract candidate listing detail URLs from an index page."""
        links = re.findall(r'href="([^"]*(?:property|listing|sale)[^"]*)"',
                           html, re.I)
        return sorted(set(links))

    def make_row(self, **fields) -> dict:
        base = {
            "asset_id": "gsa-" + hashlib.sha256(
                (fields.get("listing_url", "") or fields.get("address", "")).encode()
            ).hexdigest()[:12],
            "source_name": self.config["name"],
            "source_url": self.config["homepage"],
            "fetched_at": datetime.now(timezone.utc).isoformat(),
        }
        base.update(fields)
        return base

    def fetch_live(self) -> list[dict]:
        raise NotImplementedError(
            "gsa_real_property is not verified as cron-safe; the live parser "
            "must be written against captured real pages once "
            "jobs/verify_sources.py records a VERIFIED_* status. "
            f"Current effective status: {effective_status(self.source_id)}")
