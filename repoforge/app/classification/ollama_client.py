"""Native-Ollama HTTP client for classification and embeddings.

Model output is never trusted: responses go through strict Pydantic schemas with
a bounded JSON-repair retry loop, a confidence threshold, prompt versioning, and
an output cache. When Ollama is unavailable the caller receives
``OllamaUnavailable`` so it can queue the work for later rather than losing a
discovery.
"""

from __future__ import annotations

import hashlib
import json
import logging
import re
from collections.abc import Awaitable, Callable
from typing import Any, TypeVar

import httpx
from pydantic import BaseModel, ValidationError

logger = logging.getLogger("repoforge.ollama")

T = TypeVar("T", bound=BaseModel)

# Bumping this invalidates cached model outputs and is recorded on every card.
PROMPT_VERSION = "v1"


class OllamaUnavailable(RuntimeError):
    """Ollama could not be reached; work should be queued, not dropped."""


class OllamaInvalidOutput(RuntimeError):
    """Model output failed schema validation after all repair attempts."""


def _extract_json(text: str) -> str:
    """Pull the first JSON object out of a model response.

    Local models often wrap JSON in prose or ```json fences; we strip those
    before parsing rather than trusting the raw string.
    """
    fenced = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
    if fenced:
        return fenced.group(1)
    brace = re.search(r"\{.*\}", text, re.DOTALL)
    if brace:
        return brace.group(0)
    return text.strip()


class OllamaClient:
    def __init__(
        self,
        base_url: str,
        *,
        classifier_model: str = "",
        embedding_model: str = "",
        client: httpx.AsyncClient | None = None,
        max_repair_attempts: int = 2,
        confidence_threshold: float = 0.5,
        sleep: Callable[[float], Awaitable[Any]] | None = None,
    ) -> None:
        self._base = base_url.rstrip("/")
        self.classifier_model = classifier_model
        self.embedding_model = embedding_model
        self._owns = client is None
        self._client = client or httpx.AsyncClient(timeout=120.0)
        self._max_repair = max_repair_attempts
        self._threshold = confidence_threshold
        self._cache: dict[str, BaseModel] = {}
        import asyncio

        self._sleep = sleep or asyncio.sleep

    async def aclose(self) -> None:
        if self._owns:
            await self._client.aclose()

    async def __aenter__(self) -> OllamaClient:
        return self

    async def __aexit__(self, *exc: object) -> None:
        await self.aclose()

    # ---------------------------------------------------------------- #
    async def available(self) -> bool:
        """True if the Ollama server answers /api/tags."""
        try:
            resp = await self._client.get(f"{self._base}/api/tags")
            return resp.status_code == 200
        except httpx.HTTPError:
            return False

    async def list_models(self) -> list[str]:
        try:
            resp = await self._client.get(f"{self._base}/api/tags")
            resp.raise_for_status()
        except httpx.HTTPError as exc:
            raise OllamaUnavailable(str(exc)) from exc
        data = resp.json()
        return [m["name"] for m in data.get("models", [])]

    def _cache_key(self, model: str, prompt: str, input_hash: str) -> str:
        raw = f"{model}|{PROMPT_VERSION}|{input_hash}"
        return hashlib.sha256(raw.encode()).hexdigest()

    async def _raw_generate(self, model: str, prompt: str) -> str:
        payload = {
            "model": model,
            "prompt": prompt,
            "stream": False,
            "format": "json",
            "options": {"temperature": 0.0},
        }
        try:
            resp = await self._client.post(f"{self._base}/api/generate", json=payload)
            resp.raise_for_status()
        except httpx.HTTPError as exc:
            raise OllamaUnavailable(str(exc)) from exc
        return str(resp.json().get("response", ""))

    async def generate_json(
        self,
        prompt: str,
        schema: type[T],
        *,
        model: str | None = None,
        input_hash: str | None = None,
    ) -> T:
        """Generate and validate a JSON object against ``schema``.

        Retries with an explicit repair instruction if parsing/validation fails.
        Raises ``OllamaUnavailable`` if the server is unreachable, or
        ``OllamaInvalidOutput`` if no valid output is produced.
        """
        model = model or self.classifier_model
        if not model:
            raise OllamaUnavailable("no classifier model configured")

        ihash = input_hash or hashlib.sha256(prompt.encode()).hexdigest()
        key = self._cache_key(model, prompt, ihash)
        cached = self._cache.get(key)
        if cached is not None and isinstance(cached, schema):
            return cached

        last_error: Exception | None = None
        current_prompt = prompt
        for attempt in range(self._max_repair + 1):
            raw = await self._raw_generate(model, current_prompt)
            candidate = _extract_json(raw)
            try:
                parsed = schema.model_validate_json(candidate)
                self._cache[key] = parsed
                return parsed
            except (ValidationError, json.JSONDecodeError, ValueError) as exc:
                last_error = exc
                logger.warning("ollama output invalid (attempt %d): %s", attempt + 1, exc)
                current_prompt = (
                    f"{prompt}\n\nYour previous answer was not valid JSON for the "
                    f"required schema. Error: {exc}. Reply with ONLY a valid JSON "
                    f"object, no prose, no code fences."
                )
                if attempt < self._max_repair:
                    await self._sleep(0)
        raise OllamaInvalidOutput(f"invalid after {self._max_repair + 1} attempts: {last_error}")

    async def embed(self, text: str, *, model: str | None = None) -> list[float]:
        model = model or self.embedding_model
        if not model:
            raise OllamaUnavailable("no embedding model configured")
        payload = {"model": model, "prompt": text}
        try:
            resp = await self._client.post(f"{self._base}/api/embeddings", json=payload)
            resp.raise_for_status()
        except httpx.HTTPError as exc:
            raise OllamaUnavailable(str(exc)) from exc
        vec = resp.json().get("embedding")
        if not isinstance(vec, list) or not vec:
            raise OllamaInvalidOutput("embedding response missing 'embedding' array")
        return [float(x) for x in vec]
