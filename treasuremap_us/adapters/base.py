"""Adapter contract.

Every adapter:
  1. declares its `source_id` (key in config/sources.yaml),
  2. implements `verify()` — a programmatic access probe returning a
     verification record for data/source_verification/,
  3. implements `fetch()` — returns canonical rows, and MUST refuse to run
     unattended when the effective status is not cron-safe.

`fetch(allow_fixtures=True)` may fall back to clearly-labelled fixture data
under data/fixtures/ so the downstream pipeline can be exercised before a
source is verified. Fixture rows always carry source_status=UNKNOWN and a
"[FIXTURE]" marker in source_name — scoring then applies the -100
unverified penalty and decisions cap at PARK/IMPROVE.
"""

import json
from pathlib import Path

from core import FIXTURES_DIR
from core.http import fetch as http_fetch
from core.registry import effective_status, is_cron_safe, load_sources

OUTCOME_TO_STATUS = {
    # verifier outcome -> registry status when the probe succeeds/fails
    "captcha_suspected": "BLOCKED",
    "origin_blocked": "BLOCKED",
    "robots_disallowed": "BLOCKED",
    # runner_network_blocked means *this environment* cannot reach the
    # source; the source itself is untested, so it stays UNKNOWN.
    "runner_network_blocked": "UNKNOWN",
    "error": "UNKNOWN",
    "http_error": "UNKNOWN",
}


class NotCronSafe(RuntimeError):
    pass


class BaseAdapter:
    source_id: str = ""

    @property
    def config(self) -> dict:
        return load_sources()[self.source_id]

    # -------- verification --------
    def verify(self) -> dict:
        """Probe every probe_url; classify. Success requires TWO fetches of
        the first URL (replay test) plus content sanity checks supplied by
        `looks_valid()`."""
        probes = []
        status = "UNKNOWN"
        for i, url in enumerate(self.config.get("probe_urls", [])):
            result = http_fetch(url)
            probes.append(result.summary())
            if i == 0 and result.ok:
                replay = http_fetch(url)
                probes.append({**replay.summary(), "replay": True})
                if replay.ok and self.looks_valid(result):
                    status = self.success_status(result)
                continue
            if i == 0:
                status = OUTCOME_TO_STATUS.get(result.outcome, "UNKNOWN")
        notes = self.verification_notes(probes)
        return {"status": status, "probes": probes, "notes": notes,
                "expected_mechanics": self.config.get("expected_mechanics"),
                "production_ready": status.startswith("VERIFIED")}

    def looks_valid(self, result) -> bool:
        return len(result.body) > 200

    def success_status(self, result) -> str:
        if "json" in result.content_type.lower():
            return "VERIFIED_API"
        return self.config.get("expected_mechanics", "VERIFIED_HTML_INDEX")

    def verification_notes(self, probes) -> str:
        outcomes = {p["outcome"] for p in probes}
        if outcomes == {"runner_network_blocked"}:
            return ("All probes denied by this runner's egress policy "
                    "(proxy CONNECT 403). The source itself is UNTESTED — "
                    "re-run jobs/verify_sources.py from an environment with "
                    "network access to these hosts before any ingestion.")
        return ""

    # -------- ingestion --------
    def fetch(self, allow_fixtures: bool = False) -> list[dict]:
        status = effective_status(self.source_id)
        if is_cron_safe(self.source_id):
            return self.fetch_live()
        if allow_fixtures:
            return self.fetch_fixtures()
        raise NotCronSafe(
            f"{self.source_id}: effective status {status} is not cron-safe; "
            "verify the source first or pass allow_fixtures=True for a "
            "pipeline dry-run with labelled fixture data.")

    def fetch_live(self) -> list[dict]:
        raise NotImplementedError

    def fetch_fixtures(self) -> list[dict]:
        path = FIXTURES_DIR / f"{self.source_id}.json"
        if not path.exists():
            return []
        rows = json.loads(path.read_text(encoding="utf-8"))
        for row in rows:
            if "source_name" in row and "[FIXTURE]" not in row["source_name"]:
                row["source_name"] = f"{row['source_name']} [FIXTURE]"
            if "source_status" in row:
                row["source_status"] = "UNKNOWN"
        return rows
