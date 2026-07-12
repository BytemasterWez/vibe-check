import httpx
import pytest
from pydantic import BaseModel

from app.classification.ollama_client import (
    OllamaClient,
    OllamaInvalidOutput,
    OllamaUnavailable,
    _extract_json,
)


class Out(BaseModel):
    name: str
    score: float


async def _noop_sleep(_):
    return None


def test_extract_json_from_fenced_and_prose():
    assert _extract_json('```json\n{"a": 1}\n```') == '{"a": 1}'
    assert _extract_json('here is the answer: {"a": 1} thanks') == '{"a": 1}'


async def test_available_true_and_false():
    def up(request):
        return httpx.Response(200, json={"models": []})

    async with httpx.AsyncClient(transport=httpx.MockTransport(up)) as hc:
        assert await OllamaClient("http://x", client=hc).available() is True

    def down(request):
        raise httpx.ConnectError("refused")

    async with httpx.AsyncClient(transport=httpx.MockTransport(down)) as hc:
        assert await OllamaClient("http://x", client=hc).available() is False


async def test_generate_json_valid_first_try():
    def handler(request):
        return httpx.Response(200, json={"response": '{"name": "a", "score": 0.9}'})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as hc:
        c = OllamaClient("http://x", classifier_model="m", client=hc, sleep=_noop_sleep)
        out = await c.generate_json("prompt", Out)
    assert out.name == "a"
    assert out.score == 0.9


async def test_json_repair_recovers_from_malformed_then_valid():
    calls = {"n": 0}

    def handler(request):
        calls["n"] += 1
        if calls["n"] == 1:
            return httpx.Response(200, json={"response": "not json at all"})
        return httpx.Response(200, json={"response": '{"name": "b", "score": 0.5}'})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as hc:
        c = OllamaClient("http://x", classifier_model="m", client=hc, sleep=_noop_sleep)
        out = await c.generate_json("prompt", Out)
    assert out.name == "b"
    assert calls["n"] == 2  # repaired on the second attempt


async def test_invalid_after_all_attempts_raises():
    def handler(request):
        return httpx.Response(200, json={"response": "never valid"})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as hc:
        c = OllamaClient("http://x", classifier_model="m", client=hc,
                         sleep=_noop_sleep, max_repair_attempts=1)
        with pytest.raises(OllamaInvalidOutput):
            await c.generate_json("prompt", Out)


async def test_unavailable_raises_when_server_down():
    def handler(request):
        raise httpx.ConnectError("refused")

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as hc:
        c = OllamaClient("http://x", classifier_model="m", client=hc, sleep=_noop_sleep)
        with pytest.raises(OllamaUnavailable):
            await c.generate_json("prompt", Out)


async def test_generate_without_model_raises():
    c = OllamaClient("http://x")
    with pytest.raises(OllamaUnavailable):
        await c.generate_json("p", Out)


async def test_output_is_cached_by_input_hash():
    calls = {"n": 0}

    def handler(request):
        calls["n"] += 1
        return httpx.Response(200, json={"response": '{"name": "a", "score": 1.0}'})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as hc:
        c = OllamaClient("http://x", classifier_model="m", client=hc, sleep=_noop_sleep)
        await c.generate_json("prompt", Out, input_hash="h1")
        await c.generate_json("prompt", Out, input_hash="h1")
    assert calls["n"] == 1  # second call served from cache


async def test_embed_returns_vector():
    def handler(request):
        return httpx.Response(200, json={"embedding": [0.1, 0.2, 0.3]})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as hc:
        c = OllamaClient("http://x", embedding_model="e", client=hc)
        vec = await c.embed("hello")
    assert vec == [0.1, 0.2, 0.3]
