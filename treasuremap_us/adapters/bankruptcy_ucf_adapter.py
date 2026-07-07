"""U.S. Courts Bankruptcy Unclaimed Funds Locator (ucf.uscourts.gov).

Access model (research, pending programmatic verification):
  - Public search UI; supports GET query params observed in the wild:
      https://ucf.uscourts.gov/?CreditorName=<name>&SelectedCourts=<code>
  - No documented API or bulk download. Expected best status:
    VERIFIED_SEARCH_FORM — usable via a polite, LOW-VOLUME semi-manual
    query runner, never bulk-crawled.
  - Claim process is per-court (typically AO Form 1340 filed with the
    court holding the funds). This system NEVER files claims.

PHASE 1 strategy:
  - run seed queries from config/search_terms.yaml (ucfl_seed_queries),
  - keep only business/entity claimants (core.normalise.classify_claimant),
  - keep only amounts > scoring.yaml min_amount_usd,
  - store the court + case identifiers needed for a human claim route.
"""

import hashlib
import re
from datetime import datetime, timezone

from core.http import fetch as http_fetch
from core.normalise import classify_claimant
from core.registry import effective_status

from .base import BaseAdapter


class BankruptcyUCFAdapter(BaseAdapter):
    source_id = "bankruptcy_ucfl"

    def looks_valid(self, result) -> bool:
        text = result.text.lower()
        return "unclaimed" in text and len(result.body) > 500

    def success_status(self, result) -> str:
        # Even if the index page loads, treat as SEARCH_FORM (result pages
        # need query interaction and may paginate via JS).
        return "VERIFIED_SEARCH_FORM"

    def run_seed_query(self, creditor_name: str, court: str = "") -> "FetchResult":
        """One polite search-form query. Semi-manual runner: intended to be
        called a handful of times per session, not in a crawl loop."""
        template = self.config["search_url_template"]
        url = template.format(creditor=creditor_name.replace(" ", "+"),
                              court=court)
        return http_fetch(url)

    def parse_results(self, html: str, source_url: str, raw_path: str) -> list[dict]:
        """Parse a UCFL results page into canonical claimable_funds rows.

        The exact markup is unknown until the source is reachable from a
        verification-capable environment; this parser targets the generic
        table shape (court / case / creditor / amount) and MUST be
        re-validated against a captured real page before production use.
        """
        rows = []
        fetched_at = datetime.now(timezone.utc).isoformat()
        # generic <tr><td>...</td></tr> extraction
        for tr in re.findall(r"<tr[^>]*>(.*?)</tr>", html, re.S | re.I):
            cells = [re.sub(r"<[^>]+>", " ", c).strip()
                     for c in re.findall(r"<td[^>]*>(.*?)</td>", tr, re.S | re.I)]
            if len(cells) < 4:
                continue
            court, case_number, claimant, amount = cells[:4]
            if not re.search(r"\d", amount):
                continue
            claim_id = "ucfl-" + hashlib.sha256(
                f"{court}|{case_number}|{claimant}|{amount}".encode()
            ).hexdigest()[:12]
            rows.append({
                "claim_id": claim_id,
                "source_name": self.config["name"],
                "source_status": effective_status(self.source_id),
                "source_url": source_url,
                "court_or_agency": court,
                "state": "",
                "county_or_district": court,
                "case_number": case_number,
                "case_name": "",
                "debtor_name": "",
                "claimant_name": claimant,
                "claimant_type": classify_claimant(claimant),
                "amount": amount.replace("$", "").replace(",", ""),
                "fund_type": "bankruptcy_unclaimed_funds",
                "date_deposited": "",
                "last_updated": "",
                "claim_process_url": "https://www.uscourts.gov/court-programs/bankruptcy/unclaimed-funds-bankruptcy",
                "raw_text": " | ".join(cells),
                "raw_file_path": raw_path,
                "fetched_at": fetched_at,
            })
        return rows

    def fetch_live(self) -> list[dict]:
        import yaml

        from core import CONFIG_DIR
        with open(CONFIG_DIR / "search_terms.yaml", encoding="utf-8") as fh:
            seeds = yaml.safe_load(fh).get("ucfl_seed_queries", [])
        collected = []
        for seed in seeds:
            result = self.run_seed_query(seed)
            if not result.ok:
                continue
            collected.extend(self.parse_results(result.text, result.url,
                                                result.raw_path))
        # business/entity claimants only (PHASE 1 core rule)
        return [r for r in collected if r["claimant_type"] == "business"]
