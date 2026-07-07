"""TreasureMap US core library: schemas, registry, scoring, cards."""

from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONFIG_DIR = ROOT / "config"
DATA_DIR = ROOT / "data"
RAW_DIR = DATA_DIR / "raw"
PROCESSED_DIR = DATA_DIR / "processed"
VERIFICATION_DIR = DATA_DIR / "source_verification"
FIXTURES_DIR = DATA_DIR / "fixtures"
ENTITY_GRAPH_DIR = DATA_DIR / "entity_graph"
REPORTS_LATEST = ROOT / "reports" / "latest"
REPORTS_ARCHIVE = ROOT / "reports" / "archive"
LOGS_DIR = ROOT / "logs"
