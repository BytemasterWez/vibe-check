"""Treasury (TEOAF) seized real property auctions.

Access model (research, pending programmatic verification):
  - treasury.gov/auctions/treasury/rp/ lists seized/forfeited real
    property (residential, commercial, land, warehouses, operating
    businesses) across the U.S. and Puerto Rico.
  - Prime contractor CWS Asset Management & Sales (cwsmarketing.com)
    hosts live auction detail; CWS states listings are free to access.
  - Legacy .shtml pages suggest static HTML — expected best status
    VERIFIED_HTML_INDEX. Contractor pages (WordPress) may also be
    crawlable politely; robots.txt is checked per fetch.
  - Auction mechanics: public auctions, cashier's-check deposit to bid,
    no buyer's premium, closing typically within 45 days.
"""

import hashlib
import re
from datetime import datetime, timezone

from core.registry import effective_status

from .base import BaseAdapter


class TreasurySeizedPropertyAdapter(BaseAdapter):
    source_id = "treasury_seized_rp"

    def looks_valid(self, result) -> bool:
        text = result.text.lower()
        return ("auction" in text or "seized" in text) and len(result.body) > 500

    def parse_index(self, html: str, source_url: str, raw_path: str) -> list[dict]:
        """Parse the RP index page. Legacy Treasury auction pages present
        properties as anchor blocks with address/city/state text; the
        selector set below MUST be re-validated against a captured page
        before production use."""
        rows = []
        fetched_at = datetime.now(timezone.utc).isoformat()
        for match in re.finditer(
                r'<a[^>]+href="(?P<href>[^"]+)"[^>]*>(?P<label>[^<]{10,120})</a>',
                html, re.I):
            label = match.group("label").strip()
            if not re.search(r",\s*[A-Z]{2}\b", label):   # 'City, ST' heuristic
                continue
            state = re.search(r",\s*([A-Z]{2})\b", label).group(1)
            rows.append({
                "asset_id": "teoaf-" + hashlib.sha256(match.group("href").encode()).hexdigest()[:12],
                "source_name": self.config["name"],
                "source_url": source_url,
                "listing_url": match.group("href"),
                "listing_status": "live",
                "sale_method": "public auction (TEOAF/CWSAMS)",
                "property_name": label,
                "state": state,
                "raw_text": label,
                "raw_file_path": raw_path,
                "fetched_at": fetched_at,
            })
        return rows

    def fetch_live(self) -> list[dict]:
        raise NotImplementedError(
            "treasury_seized_rp is not verified as cron-safe; validate "
            "parse_index() against captured real pages after verification. "
            f"Current effective status: {effective_status(self.source_id)}")
