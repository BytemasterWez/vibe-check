"""Ingest claimable funds (Engine 1, PHASE 1: bankruptcy UCF only).

Filters enforced here regardless of adapter behaviour:
  - business/entity claimants only (individuals dropped, not scored),
  - amount >= scoring.yaml claimable_funds.min_amount_usd.
"""

import _bootstrap  # noqa: F401

import argparse

import yaml

from adapters.bankruptcy_ucf_adapter import BankruptcyUCFAdapter
from adapters.base import NotCronSafe
from core import CONFIG_DIR, REPORTS_LATEST
from core.registry import effective_status
from core.schemas import CLAIMABLE_FUNDS, write_csv


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--fixtures", action="store_true")
    args = parser.parse_args()

    with open(CONFIG_DIR / "scoring.yaml", encoding="utf-8") as fh:
        min_amount = yaml.safe_load(fh)["claimable_funds"]["min_amount_usd"]

    adapter = BankruptcyUCFAdapter()
    status = effective_status(adapter.source_id)
    try:
        rows = adapter.fetch(allow_fixtures=args.fixtures)
    except (NotCronSafe, NotImplementedError) as exc:
        print(f"SKIP {adapter.source_id} [{status}]: {exc}")
        rows = []

    kept, dropped_type, dropped_amount = [], 0, 0
    for row in rows:
        if row.get("claimant_type") != "business":
            dropped_type += 1
            continue
        try:
            amount = float(str(row.get("amount", 0)).replace(",", ""))
        except ValueError:
            amount = 0
        if amount < min_amount:
            dropped_amount += 1
            continue
        kept.append(row)

    out = REPORTS_LATEST / "claimable_funds" / "claimable_funds.csv"
    write_csv(out, kept, CLAIMABLE_FUNDS)
    print(f"kept {len(kept)} business claims >= ${min_amount:,.0f} "
          f"(dropped: {dropped_type} non-business, {dropped_amount} below "
          f"threshold) -> {out}")


if __name__ == "__main__":
    main()
