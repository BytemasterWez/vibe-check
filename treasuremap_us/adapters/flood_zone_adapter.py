"""FEMA National Flood Hazard Layer enrichment (point -> flood zone).

Uses the public NFHL ArcGIS REST service. Keyless, but must be verified
(hazards.fema.gov availability varies) before cron use.
"""

import json

from core.http import fetch as http_fetch

from .base import BaseAdapter

NFHL_QUERY = ("https://hazards.fema.gov/arcgis/rest/services/public/NFHL/"
              "MapServer/28/query?geometry={lon},{lat}"
              "&geometryType=esriGeometryPoint&inSR=4326"
              "&outFields=FLD_ZONE,ZONE_SUBTY&returnGeometry=false&f=json")


class FloodZoneAdapter(BaseAdapter):
    source_id = "fema_nfhl"

    def looks_valid(self, result) -> bool:
        try:
            return "error" not in json.loads(result.text)
        except (ValueError, TypeError):
            return False

    def zone_for_point(self, lat: float, lon: float) -> dict:
        """Return {'fema_flood_zone': ..., 'raw_path': ...} or {} on failure."""
        result = http_fetch(NFHL_QUERY.format(lat=lat, lon=lon))
        if not result.ok:
            return {}
        try:
            features = json.loads(result.text).get("features", [])
        except ValueError:
            return {}
        if not features:
            return {"fema_flood_zone": "NONE_MAPPED", "raw_path": result.raw_path}
        attrs = features[0].get("attributes", {})
        zone = attrs.get("FLD_ZONE", "")
        subtype = attrs.get("ZONE_SUBTY", "")
        return {"fema_flood_zone": f"{zone} {subtype}".strip(),
                "raw_path": result.raw_path}

    def fetch_live(self):  # enrichment adapters enrich; they don't ingest
        return []
