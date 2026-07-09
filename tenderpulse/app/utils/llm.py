"""Optional LLM summariser (Phase 8C). OpenRouter-compatible chat endpoint.

Strictly additive: only ever called when OPENROUTER_API_KEY is set, always
wrapped in try/except by callers, and spend-capped. The product's data path
(ingest, normalise, validate, score) never touches this module.
"""
import json
from datetime import datetime

import requests

from .. import config

_COST_LEDGER = config.DATA_DIR / "llm_spend.json"
# Conservative flat estimate per call for cap accounting (DeepSeek-class pricing).
_EST_COST_PER_CALL_USD = 0.002


def _month_key() -> str:
    return datetime.utcnow().strftime("%Y-%m")


def _spend_this_month() -> float:
    try:
        ledger = json.loads(_COST_LEDGER.read_text())
        return float(ledger.get(_month_key(), 0.0))
    except (OSError, ValueError):
        return 0.0


def _record_spend() -> None:
    config.ensure_dirs()
    try:
        ledger = json.loads(_COST_LEDGER.read_text())
    except (OSError, ValueError):
        ledger = {}
    ledger[_month_key()] = ledger.get(_month_key(), 0.0) + _EST_COST_PER_CALL_USD
    _COST_LEDGER.write_text(json.dumps(ledger))


class LLMBudgetExceeded(Exception):
    pass


def summarise(text: str) -> str:
    if _spend_this_month() >= config.LLM_MONTHLY_COST_CAP:
        raise LLMBudgetExceeded(
            f"monthly LLM cap ${config.LLM_MONTHLY_COST_CAP} reached; summary skipped"
        )
    resp = requests.post(
        f"{config.LLM_BASE_URL}/chat/completions",
        headers={"Authorization": f"Bearer {config.LLM_API_KEY}"},
        json={
            "model": config.LLM_MODEL,
            "max_tokens": config.LLM_MAX_TOKENS,
            "messages": [
                {
                    "role": "system",
                    "content": (
                        "You summarise UK public tender digests for a bid manager. "
                        "Two or three sentences. Mention only facts present in the digest; "
                        "never invent tenders, buyers, values, or deadlines."
                    ),
                },
                {"role": "user", "content": text[:8000]},
            ],
        },
        timeout=30,
    )
    resp.raise_for_status()
    _record_spend()
    return resp.json()["choices"][0]["message"]["content"].strip()
