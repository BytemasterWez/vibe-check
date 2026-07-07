"""Source verification job — the gatekeeper for the whole system.

For every source in config/sources.yaml:
  - run the adapter's programmatic probe (replay-tested),
  - record the honest status to data/source_verification/<id>.json,
  - never upgrade a status by assumption.

Also writes data/source_verification/source_verification_report.md for
human review. Run daily (cron: daily-source-verification) and before any
ingest. Exit code 1 if any previously-verified source regressed.
"""

import _bootstrap  # noqa: F401

import json
import sys
from datetime import datetime, timezone

from adapters.base import BaseAdapter
from adapters.bankruptcy_ucf_adapter import BankruptcyUCFAdapter
from adapters.entity_registry_adapter import EntityRegistryAdapter
from adapters.flood_zone_adapter import FloodZoneAdapter
from adapters.gsa_real_property_adapter import GSARealPropertyAdapter
from adapters.opportunity_zone_adapter import OpportunityZoneAdapter
from adapters.treasury_seized_property_adapter import TreasurySeizedPropertyAdapter
from adapters.usms_forfeited_property_adapter import USMSForfeitedPropertyAdapter
from core import VERIFICATION_DIR
from core.registry import (VERIFIED_STATUSES, load_sources,
                           load_verification, save_verification)

ADAPTERS = {
    "bankruptcy_ucfl": BankruptcyUCFAdapter,
    "gsa_real_property": GSARealPropertyAdapter,
    "treasury_seized_rp": TreasurySeizedPropertyAdapter,
    "usms_forfeited_rp": USMSForfeitedPropertyAdapter,
    "fema_nfhl": FloodZoneAdapter,
    "hud_opportunity_zones": OpportunityZoneAdapter,
    "sec_edgar": EntityRegistryAdapter,
}


class GenericAdapter(BaseAdapter):
    def __init__(self, source_id):
        self.source_id = source_id


def main() -> int:
    sources = load_sources()
    regressions, lines = [], []
    for source_id, cfg in sources.items():
        previous = load_verification(source_id)
        adapter_cls = ADAPTERS.get(source_id)
        adapter = adapter_cls() if adapter_cls else GenericAdapter(source_id)
        print(f"verifying {source_id} ({cfg['name']}) ...")
        result = adapter.verify()
        save_verification(source_id, result)
        status = result["status"]
        if previous and previous["status"] in VERIFIED_STATUSES \
                and status not in VERIFIED_STATUSES:
            regressions.append(source_id)
        flag = "REGRESSED" if source_id in regressions else ""
        print(f"  -> {status} {flag}")
        lines.append((source_id, cfg["name"], status,
                      result.get("notes", ""), flag))

    report = ["# Source Verification Report",
              f"\nGenerated: {datetime.now(timezone.utc).isoformat()}",
              "\n| Source | Status | Regressed | Notes |",
              "|--------|--------|-----------|-------|"]
    for source_id, name, status, notes, flag in lines:
        report.append(f"| {name} (`{source_id}`) | {status} | {flag or '—'} "
                      f"| {notes or '—'} |")
    report.append("\nStatuses beginning `VERIFIED_` are production-eligible; "
                  "`UNKNOWN` sources are untested (often runner-side network "
                  "policy); `BLOCKED` sources must not be crawled.")
    out = VERIFICATION_DIR / "source_verification_report.md"
    out.write_text("\n".join(report) + "\n", encoding="utf-8")
    print(f"\nreport: {out}")

    summary = {s: json.loads((VERIFICATION_DIR / f"{s}.json").read_text())["status"]
               for s in sources}
    print(json.dumps(summary, indent=2))
    return 1 if regressions else 0


if __name__ == "__main__":
    sys.exit(main())
