"""Central configuration for RepoForge.

All operational knobs are environment-driven so the same image runs on the Mac
Mini and in CI. Nothing here reads secrets at import time beyond what
pydantic-settings pulls from the environment; secrets are never logged.
"""

from __future__ import annotations

from enum import Enum
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Mode(str, Enum):
    """Operating modes required by the spec."""

    metadata = "metadata"
    local_ai = "local_ai"
    paused = "paused"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # --- Core ---
    repoforge_mode: Mode = Mode.local_ai
    repoforge_data_dir: str = "/Volumes/RepoForge/repoforge-data"
    repoforge_port: int = 18765
    timezone: str = "Europe/London"
    log_level: str = "INFO"

    # --- GitHub ---
    github_token: str = ""
    github_api_budget_per_hour: int = 1000
    github_max_concurrency: int = 3
    github_api_base: str = "https://api.github.com"

    # --- Ollama ---
    ollama_base_url: str = "http://host.docker.internal:11434"
    ollama_classifier_model: str = ""
    ollama_embedding_model: str = ""

    # --- Telegram ---
    telegram_bot_token: str = ""
    telegram_chat_id: str = ""

    # --- Security ---
    admin_token: str = ""

    # --- Postgres ---
    postgres_user: str = "repoforge"
    postgres_password: str = ""
    postgres_db: str = "repoforge"
    postgres_host: str = "db"
    postgres_port: int = 5432

    # --- Scheduling / ops ---
    daily_report_time: str = "08:00"
    backup_retention_days: int = 14
    min_free_disk_gb: int = 25

    # --- Discovery tuning ---
    term_promotion_threshold: int = 3
    prototype_min_days: int = 14
    prototype_max_days: int = 30

    @property
    def database_url(self) -> str:
        pw = self.postgres_password
        return (
            f"postgresql+psycopg://{self.postgres_user}:{pw}"
            f"@{self.postgres_host}:{self.postgres_port}/{self.postgres_db}"
        )

    @property
    def github_configured(self) -> bool:
        return bool(self.github_token)

    @property
    def telegram_configured(self) -> bool:
        return bool(self.telegram_bot_token and self.telegram_chat_id)

    def safe_status(self) -> dict[str, object]:
        """Configuration surface for the dashboard, with secrets redacted."""
        return {
            "mode": self.repoforge_mode.value,
            "data_dir": self.repoforge_data_dir,
            "port": self.repoforge_port,
            "timezone": self.timezone,
            "github_configured": self.github_configured,
            "github_api_budget_per_hour": self.github_api_budget_per_hour,
            "ollama_base_url": self.ollama_base_url,
            "ollama_classifier_model": self.ollama_classifier_model or "(unset)",
            "ollama_embedding_model": self.ollama_embedding_model or "(unset)",
            "telegram_configured": self.telegram_configured,
            "admin_token_set": bool(self.admin_token),
            "min_free_disk_gb": self.min_free_disk_gb,
        }


@lru_cache
def get_settings() -> Settings:
    return Settings()
