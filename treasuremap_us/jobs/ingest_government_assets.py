"""Ingest government asset listings (Engine 2).

Live mode pulls only from cron-safe verified sources. `--fixtures` runs
the pipeline on labelled synthetic fixture data (source_status forced to
UNKNOWN, [FIXTURE] tag) so downstream jobs can be exercised before any
source is verified.
"""

import _bootstrap  # noqa: F401

import argparse

from adapters.base import NotCronSafe
from adapters.gsa_real_property_adapter import GSARealPropertyAdapter
from adapters.treasury_seized_property_adapter import TreasurySeizedPropertyAdapter
from adapters.usms_forfeited_property_adapter import USMSForfeitedPropertyAdapter
from core import REPORTS_LATEST
from core.registry import effective_status
from core.schemas import GOVERNMENT_ASSET_LISTINGS, write_csv

ADAPTERS = [GSARealPropertyAdapter, TreasurySeizedPropertyAdapter,
            USMSForfeitedPropertyAdapter]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--fixtures", action="store_true",
                        help="allow labelled fixture data for unverified sources")
    args = parser.parse_args()

    rows = []
    for adapter_cls in ADAPTERS:
        adapter = adapter_cls()
        status = effective_status(adapter.source_id)
        try:
            fetched = adapter.fetch(allow_fixtures=args.fixtures)
        except (NotCronSafe, NotImplementedError) as exc:
            print(f"SKIP {adapter.source_id} [{status}]: {exc}")
            continue
        print(f"OK   {adapter.source_id} [{status}]: {len(fetched)} listings")
        rows.extend(fetched)

    out = REPORTS_LATEST / "government_assets" / "government_asset_listings.csv"
    write_csv(out, rows, GOVERNMENT_ASSET_LISTINGS)
    print(f"wrote {len(rows)} listings -> {out}")


if __name__ == "__main__":
    main()
