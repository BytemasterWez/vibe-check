"""Telegram notifications with alert deduplication.

Alerts are deduplicated by a stable key so the same unchanged combination is
never re-sent. Sending is a no-op (logged) when credentials are absent, so the
rest of the system runs unchanged in tests and metadata mode.
"""

from __future__ import annotations

import logging

import httpx

logger = logging.getLogger("repoforge.telegram")


class TelegramNotifier:
    def __init__(
        self,
        bot_token: str,
        chat_id: str,
        *,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        self._token = bot_token
        self._chat_id = chat_id
        self._owns = client is None
        self._client = client or httpx.AsyncClient(timeout=15.0)
        self._sent_keys: set[str] = set()

    @property
    def configured(self) -> bool:
        return bool(self._token and self._chat_id)

    async def aclose(self) -> None:
        if self._owns:
            await self._client.aclose()

    def should_send(self, dedup_key: str) -> bool:
        return dedup_key not in self._sent_keys

    async def send(self, text: str, *, dedup_key: str | None = None) -> bool:
        """Send a message. Returns True if actually dispatched.

        If ``dedup_key`` was already sent, this is skipped (returns False).
        If credentials are missing, logs and returns False without raising.
        """
        if dedup_key is not None and not self.should_send(dedup_key):
            logger.info("telegram: skipping duplicate alert %s", dedup_key)
            return False
        if not self.configured:
            logger.info("telegram: not configured; would send: %s", text[:80])
            if dedup_key is not None:
                self._sent_keys.add(dedup_key)
            return False
        url = f"https://api.telegram.org/bot{self._token}/sendMessage"
        try:
            resp = await self._client.post(
                url,
                json={"chat_id": self._chat_id, "text": text, "parse_mode": "Markdown"},
            )
            resp.raise_for_status()
        except httpx.HTTPError as exc:
            logger.error("telegram send failed: %s", exc)
            return False
        if dedup_key is not None:
            self._sent_keys.add(dedup_key)
        return True
