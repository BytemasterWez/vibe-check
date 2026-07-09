"""Central configuration, sourced from environment variables with safe defaults."""
import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.environ.get("TP_DATA_DIR", BASE_DIR / "data"))
RAW_DIR = DATA_DIR / "raw"
EXPORT_DIR = DATA_DIR / "exports"
REPORT_DIR = DATA_DIR / "reports"

# SQLite by default so the system runs with zero external services.
# Set DATABASE_URL=postgresql+psycopg2://user:pass@host/db for Postgres.
DATABASE_URL = os.environ.get("DATABASE_URL", f"sqlite:///{DATA_DIR / 'tenderpulse.db'}")

CONTRACTS_FINDER_BASE = os.environ.get(
    "CF_BASE", "https://www.contractsfinder.service.gov.uk/Published/Notices/OCDS/Search"
)
FIND_A_TENDER_BASE = os.environ.get(
    "FTS_BASE", "https://www.find-tender.service.gov.uk/api/1.0/ocdsReleasePackages"
)

HTTP_TIMEOUT = int(os.environ.get("TP_HTTP_TIMEOUT", "30"))
HTTP_RETRIES = int(os.environ.get("TP_HTTP_RETRIES", "3"))
MAX_PAGES_PER_RUN = int(os.environ.get("TP_MAX_PAGES", "50"))
PAGE_SIZE = int(os.environ.get("TP_PAGE_SIZE", "100"))

# Optional LLM (Phase 8C): off unless a key is set. The pipeline never depends on it.
LLM_API_KEY = os.environ.get("OPENROUTER_API_KEY", "")
LLM_MODEL = os.environ.get("TP_LLM_MODEL", "deepseek/deepseek-chat")
LLM_BASE_URL = os.environ.get("TP_LLM_BASE_URL", "https://openrouter.ai/api/v1")
LLM_MAX_TOKENS = int(os.environ.get("TP_LLM_MAX_TOKENS", "600"))
# Hard monthly cost cap in USD; the summariser refuses to call out once exceeded.
LLM_MONTHLY_COST_CAP = float(os.environ.get("TP_LLM_COST_CAP", "5.0"))


def ensure_dirs() -> None:
    for d in (DATA_DIR, RAW_DIR, EXPORT_DIR, REPORT_DIR):
        d.mkdir(parents=True, exist_ok=True)
