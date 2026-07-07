"""Parcel/assessor enrichment (parcel_id, land_use, assessed value).

County GIS ArcGIS REST services where public; otherwise
VERIFIED_MANUAL_ONLY lookup instructions embedded in the asset card.
Activated per-county alongside the asset pipeline."""

from .base import BaseAdapter


class ParcelEnrichmentAdapter(BaseAdapter):
    source_id = "parcel_enrichment"

    def fetch_live(self):
        return []
