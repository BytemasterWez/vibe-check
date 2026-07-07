"""Qualified Opportunity Zone enrichment.

QOZ designations are a FIXED list of census tracts (unchanged since 2018),
so the correct architecture is: one verified download of the tract list ->
local GEOID lookup forever. Needs the Census geocoder (census_geocoder
source) to turn an address/point into a tract GEOID.
"""

import csv
import json
from pathlib import Path

from core import DATA_DIR
from core.http import fetch as http_fetch

from .base import BaseAdapter

LOCAL_TRACTS = DATA_DIR / "processed" / "qoz_tracts.csv"

CENSUS_COORD_URL = ("https://geocoding.geo.census.gov/geocoder/geographies/"
                    "coordinates?x={lon}&y={lat}&benchmark=Public_AR_Current"
                    "&vintage=Current_Current&format=json")


class OpportunityZoneAdapter(BaseAdapter):
    source_id = "hud_opportunity_zones"

    def looks_valid(self, result) -> bool:
        return len(result.body) > 10000  # geojson download should be large

    def load_tracts(self) -> set[str]:
        if not LOCAL_TRACTS.exists():
            return set()
        with open(LOCAL_TRACTS, newline="", encoding="utf-8") as fh:
            return {row["geoid"] for row in csv.DictReader(fh)}

    def tract_for_point(self, lat: float, lon: float) -> str:
        result = http_fetch(CENSUS_COORD_URL.format(lat=lat, lon=lon))
        if not result.ok:
            return ""
        try:
            geographies = json.loads(result.text)["result"]["geographies"]
            return geographies["Census Tracts"][0]["GEOID"]
        except (ValueError, KeyError, IndexError):
            return ""

    def is_opportunity_zone(self, lat: float, lon: float) -> str:
        """'yes' / 'no' / '' (unknown)."""
        tracts = self.load_tracts()
        if not tracts:
            return ""
        geoid = self.tract_for_point(lat, lon)
        if not geoid:
            return ""
        return "yes" if geoid in tracts else "no"

    def fetch_live(self):
        return []
