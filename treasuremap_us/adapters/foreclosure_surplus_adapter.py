"""Mortgage foreclosure surplus funds held by court registries,
commercial owners only — PHASE 3. Same county-level fragmentation and
strategy as tax-sale surplus."""

from .base import BaseAdapter


class ForeclosureSurplusAdapter(BaseAdapter):
    source_id = "foreclosure_surplus"

    def fetch_live(self):
        raise NotImplementedError("PHASE 3 — activate after verification")
