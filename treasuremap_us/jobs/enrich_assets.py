"""Enrich government asset listings (Engine 2).

Live path: geocode (Census), flood zone (FEMA NFHL), Opportunity Zone
(local QOZ tract table) — each gated on its source being verified.
Fixture path (--fixtures): joins data/fixtures/asset_enrichment.json by
asset_id so scoring/cards can be exercised end-to-end.
"""

import _bootstrap  # noqa: F401

import argparse
import json

from adapters.flood_zone_adapter import FloodZoneAdapter
from adapters.opportunity_zone_adapter import OpportunityZoneAdapter
from core import FIXTURES_DIR, REPORTS_LATEST
from core.registry import is_verified
from core.schemas import ASSET_ENRICHMENT, read_csv, write_csv

LISTINGS_CSV = REPORTS_LATEST / "government_assets" / "government_asset_listings.csv"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--fixtures", action="store_true")
    args = parser.parse_args()

    listings = read_csv(LISTINGS_CSV)
    fixture_enrichment = {}
    if args.fixtures:
        path = FIXTURES_DIR / "asset_enrichment.json"
        if path.exists():
            fixture_enrichment = {row["asset_id"]: row
                                  for row in json.loads(path.read_text())}

    flood = FloodZoneAdapter()
    oz = OpportunityZoneAdapter()
    rows = []
    for listing in listings:
        row = {"asset_id": listing["asset_id"]}
        row.update(fixture_enrichment.get(listing["asset_id"], {}))
        lat, lon = listing.get("lat"), listing.get("lon")
        if lat and lon:
            if is_verified("fema_nfhl") and not row.get("fema_flood_zone"):
                row.update({k: v for k, v in
                            flood.zone_for_point(float(lat), float(lon)).items()
                            if k in ASSET_ENRICHMENT})
            if is_verified("hud_opportunity_zones") and is_verified("census_geocoder") \
                    and not row.get("opportunity_zone"):
                row["opportunity_zone"] = oz.is_opportunity_zone(float(lat), float(lon))
        rows.append({k: row.get(k, "") for k in ASSET_ENRICHMENT})

    out = REPORTS_LATEST / "government_assets" / "asset_enrichment.csv"
    write_csv(out, rows, ASSET_ENRICHMENT)
    print(f"enriched {len(rows)} assets -> {out}")


if __name__ == "__main__":
    main()
