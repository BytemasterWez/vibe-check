"""County tax-sale excess proceeds, commercial owners only — PHASE 3.

Highly fragmented (county-level PDFs/spreadsheets). Strategy: start with
counties that publish surplus lists as downloadable files
(VERIFIED_DOWNLOAD), e.g. many Texas and Florida counties; parse owner
names; keep entity owners only. State fee statutes gate monetisation.
"""

from .base import BaseAdapter


class TaxSaleSurplusAdapter(BaseAdapter):
    source_id = "tax_sale_surplus"

    def fetch_live(self):
        raise NotImplementedError("PHASE 3 — county-by-county activation after verification")
