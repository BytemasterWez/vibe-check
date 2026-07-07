"""Zoning enrichment — municipal zoning layers via public ArcGIS REST
services where available; VERIFIED_MANUAL_ONLY otherwise. Activated
per-jurisdiction."""

from .base import BaseAdapter


class ZoningAdapter(BaseAdapter):
    source_id = "zoning"

    def fetch_live(self):
        return []
