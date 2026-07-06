"""Environment-driven settings. Everything is reproducible from config:
no code path may embed credentials, URLs or geography assumptions that
belong in contracts or the environment."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
CONTRACTS_DIR = PROJECT_ROOT / "contracts"
SEEDS_DIR = PROJECT_ROOT / "db" / "seeds"
MIGRATIONS_DIR = PROJECT_ROOT / "db" / "migrations"
EXPORTS_DIR = PROJECT_ROOT / "exports"
FIXTURES_DIR = PROJECT_ROOT / "tests" / "fixtures"


@dataclass
class Settings:
    database_url: str = field(
        default_factory=lambda: os.environ.get(
            "CSE_DATABASE_URL",
            "postgresql+psycopg2://countysignal:countysignal@localhost:5432/countysignal",
        )
    )
    api_database_url: str = field(
        default_factory=lambda: os.environ.get("CSE_API_DATABASE_URL", "")
    )
    redis_url: str = field(
        default_factory=lambda: os.environ.get("CSE_REDIS_URL", "redis://localhost:6379/0")
    )
    object_store: str = field(
        default_factory=lambda: os.environ.get("CSE_OBJECT_STORE", "local")
    )
    raw_dir: str = field(default_factory=lambda: os.environ.get("CSE_RAW_DIR", "/data/raw"))
    s3_endpoint: str = field(default_factory=lambda: os.environ.get("CSE_S3_ENDPOINT", ""))
    s3_bucket: str = field(default_factory=lambda: os.environ.get("CSE_S3_BUCKET", "cse-raw"))
    s3_access_key: str = field(default_factory=lambda: os.environ.get("CSE_S3_ACCESS_KEY", ""))
    s3_secret_key: str = field(default_factory=lambda: os.environ.get("CSE_S3_SECRET_KEY", ""))
    api_keys: list[str] = field(
        default_factory=lambda: [
            k.strip() for k in os.environ.get("CSE_API_KEYS", "").split(",") if k.strip()
        ]
    )
    rate_limit_per_minute: int = field(
        default_factory=lambda: int(os.environ.get("CSE_RATE_LIMIT_PER_MINUTE", "120"))
    )
    census_api_key: str = field(default_factory=lambda: os.environ.get("CENSUS_API_KEY", ""))
    bls_api_key: str = field(default_factory=lambda: os.environ.get("BLS_API_KEY", ""))


def get_settings() -> Settings:
    return Settings()
