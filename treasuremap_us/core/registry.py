"""Source registry: loads config/sources.yaml and resolves each source's
*effective* status. The effective status is what the verifier last recorded
on disk — never the declared expectation. Unverified sources cannot enter
production scoring without the -100 penalty."""

import json
from datetime import datetime, timezone
from pathlib import Path

import yaml

from . import CONFIG_DIR, VERIFICATION_DIR

VERIFIED_STATUSES = {
    "VERIFIED_API", "VERIFIED_DOWNLOAD", "VERIFIED_HTML_INDEX",
    "VERIFIED_SEARCH_FORM", "VERIFIED_BROWSER_SESSION",
    "VERIFIED_MANUAL_ONLY", "VERIFIED_PAID_API",
}
ALL_STATUSES = VERIFIED_STATUSES | {"BLOCKED", "UNKNOWN"}

# Statuses safe for unattended cron ingestion.
CRON_SAFE_STATUSES = {"VERIFIED_API", "VERIFIED_DOWNLOAD", "VERIFIED_HTML_INDEX"}


def load_config() -> dict:
    with open(CONFIG_DIR / "sources.yaml", encoding="utf-8") as fh:
        return yaml.safe_load(fh)


def load_sources() -> dict:
    return load_config()["sources"]


def operator() -> dict:
    op = load_config()["operator"]
    op["user_agent"] = op["user_agent"].format(contact=op["contact"])
    return op


def verification_path(source_id: str) -> Path:
    return VERIFICATION_DIR / f"{source_id}.json"


def load_verification(source_id: str) -> dict | None:
    path = verification_path(source_id)
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    return None


def save_verification(source_id: str, result: dict) -> Path:
    if result.get("status") not in ALL_STATUSES:
        raise ValueError(f"invalid status {result.get('status')!r}")
    result["source_id"] = source_id
    result["verified_at"] = datetime.now(timezone.utc).isoformat()
    path = verification_path(source_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(result, indent=2), encoding="utf-8")
    return path


def effective_status(source_id: str) -> str:
    """The status that scoring and ingestion must use. Only the on-disk
    verifier record counts; a source never verified is UNKNOWN."""
    record = load_verification(source_id)
    return record["status"] if record else "UNKNOWN"


def is_verified(source_id: str) -> bool:
    return effective_status(source_id) in VERIFIED_STATUSES


def is_cron_safe(source_id: str) -> bool:
    return effective_status(source_id) in CRON_SAFE_STATUSES
