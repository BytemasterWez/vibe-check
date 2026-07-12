import httpx

from app.notifications.telegram import TelegramNotifier


async def test_unconfigured_notifier_is_noop():
    n = TelegramNotifier("", "")
    assert n.configured is False
    sent = await n.send("hello", dedup_key="k1")
    assert sent is False


async def test_deduplicates_repeated_alerts():
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        return httpx.Response(200, json={"ok": True})

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as hc:
        n = TelegramNotifier("tok", "chat", client=hc)
        first = await n.send("10/10 combo X", dedup_key="combo-x")
        second = await n.send("10/10 combo X", dedup_key="combo-x")
    assert first is True
    assert second is False
    assert calls["n"] == 1  # only one real HTTP call


async def test_distinct_keys_both_send():
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        return httpx.Response(200, json={"ok": True})

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as hc:
        n = TelegramNotifier("tok", "chat", client=hc)
        await n.send("a", dedup_key="a")
        await n.send("b", dedup_key="b")
    assert calls["n"] == 2


async def test_send_failure_is_handled():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, json={"ok": False})

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as hc:
        n = TelegramNotifier("tok", "chat", client=hc)
        ok = await n.send("boom", dedup_key="x")
    assert ok is False
