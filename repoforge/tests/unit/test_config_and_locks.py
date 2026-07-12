from app.config import Mode, Settings
from app.reliability.locks import _lock_key


def test_safe_status_redacts_secrets():
    s = Settings(
        github_token="ghp_secret",
        admin_token="admintok",
        telegram_bot_token="botsecret",
        telegram_chat_id="123",
        postgres_password="pgsecret",
    )
    status = s.safe_status()
    flat = str(status)
    assert "ghp_secret" not in flat
    assert "admintok" not in flat
    assert "botsecret" not in flat
    assert "pgsecret" not in flat
    assert status["github_configured"] is True
    assert status["telegram_configured"] is True
    assert status["admin_token_set"] is True


def test_database_url_built_from_parts():
    s = Settings(postgres_user="u", postgres_password="p", postgres_db="d",
                 postgres_host="h", postgres_port=6543)
    assert s.database_url == "postgresql+psycopg://u:p@h:6543/d"


def test_mode_enum_values():
    assert Settings(repoforge_mode="paused").repoforge_mode is Mode.paused


def test_advisory_lock_key_is_deterministic_and_in_range():
    k1 = _lock_key("discovery")
    k2 = _lock_key("discovery")
    assert k1 == k2
    assert _lock_key("a") != _lock_key("b")
    assert -(2**63) <= k1 < 2**63
