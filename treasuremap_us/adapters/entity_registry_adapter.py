"""Entity registry lookups for Engine 3 (successor resolution).

Routes, in priority order:
  1. SEC EDGAR (data.sec.gov / efts.sec.gov) — free, keyless, but requires
     a declared User-Agent (already set by core.http). Best evidence for
     mergers/renames of registered companies.
  2. OpenCorporates — treated as VERIFIED_PAID_API; only used when
     OPENCORPORATES_API_KEY is set and licensing is confirmed.
  3. State Secretary of State portals — mostly VERIFIED_SEARCH_FORM or
     VERIFIED_MANUAL_ONLY; handled as per-state lookup instructions in the
     evidence pack rather than automated crawls.
"""

import json
import os

from core.http import fetch as http_fetch
from core.normalise import normalise_name

from .base import BaseAdapter

EDGAR_FTS = ("https://efts.sec.gov/LATEST/search-index?q=%22{query}%22"
             "&dateRange=custom&forms=8-K")
EDGAR_COMPANY_SEARCH = ("https://www.sec.gov/cgi-bin/browse-edgar?"
                        "action=getcompany&company={query}&type=&dateb=&"
                        "owner=include&count=10&output=atom")


class EntityRegistryAdapter(BaseAdapter):
    source_id = "sec_edgar"

    def looks_valid(self, result) -> bool:
        return result.status_code == 200

    def edgar_company_search(self, name: str):
        """Search EDGAR's company index for a (former) company name; the
        atom feed includes 'formerly' names, the highest-value successor
        signal for registered companies."""
        return http_fetch(EDGAR_COMPANY_SEARCH.format(
            query=normalise_name(name).replace(" ", "+")))

    def opencorporates_search(self, name: str):
        key = os.environ.get("OPENCORPORATES_API_KEY")
        if not key:
            return None  # paid API not configured; skip silently
        url = ("https://api.opencorporates.com/v0.4/companies/search"
               f"?q={normalise_name(name).replace(' ', '+')}&api_token={key}")
        result = http_fetch(url, archive=True)
        if not result.ok:
            return None
        try:
            return json.loads(result.text)
        except ValueError:
            return None

    def fetch_live(self):
        return []
