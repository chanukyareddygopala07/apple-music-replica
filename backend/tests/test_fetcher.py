"""HTTP fetcher rules every provider inherits: timeouts, throttling, secrets."""

from __future__ import annotations

import asyncio

import httpx
import pytest

from app.providers.base import (
    HttpFetcher,
    ProviderError,
    RequestGate,
    dedupe_by_id,
    safe_url,
)


def fetcher(routes) -> HttpFetcher:  # noqa: ANN001 - list of (pattern, value)
    calls: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        for pattern, value in routes:
            if pattern in str(request.url):
                if isinstance(value, Exception):
                    raise value
                if callable(value):
                    return value(request)
                return value
        return httpx.Response(404)

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    return HttpFetcher(client, allowed_host="api.example.com", timeout_s=1.0, gate=RequestGate(0))


async def test_only_the_configured_host_is_ever_contacted() -> None:
    f = fetcher([])
    with pytest.raises(ProviderError) as excinfo:
        await f.get_json("https://evil.example.com/steal")
    assert excinfo.value.kind == "unavailable"
    assert "unexpected upstream host" in excinfo.value.message

    with pytest.raises(ProviderError):
        await f.get_json("file:///etc/passwd")
    await f.close()


async def test_timeouts_become_typed_provider_errors() -> None:
    f = fetcher([("/x", httpx.ConnectTimeout("slow"))])
    with pytest.raises(ProviderError) as excinfo:
        await f.get_json("https://api.example.com/x")
    assert excinfo.value.kind == "timeout"
    await f.close()


async def test_rate_limit_retries_once_and_honours_retry_after() -> None:
    attempts = {"n": 0}

    def limited(request: httpx.Request) -> httpx.Response:
        attempts["n"] += 1
        if attempts["n"] == 1:
            return httpx.Response(429, headers={"Retry-After": "0"})
        return httpx.Response(200, json={"ok": True})

    f = fetcher([("/x", limited)])
    body = await f.get_json("https://api.example.com/x")
    assert body == {"ok": True}
    assert attempts["n"] == 2
    await f.close()


async def test_persistent_rate_limit_raises_without_retrying_forever() -> None:
    attempts = {"n": 0}

    def limited(request: httpx.Request) -> httpx.Response:
        attempts["n"] += 1
        return httpx.Response(429)

    f = fetcher([("/x", limited)])
    with pytest.raises(ProviderError) as excinfo:
        await f.get_json("https://api.example.com/x")
    assert excinfo.value.kind == "rate_limited"
    assert attempts["n"] == 2  # original + one retry
    await f.close()


async def test_upstream_errors_never_echo_credentials() -> None:
    f = fetcher(
        [
            (
                "/x",
                httpx.Response(
                    401,
                    json={"message": "invalid api_key=AIzaSECRET value client_id=abc123"},
                ),
            )
        ]
    )
    with pytest.raises(ProviderError) as excinfo:
        await f.get_json("https://api.example.com/x", {"api_key": "AIzaSECRET"})
    message = excinfo.value.message
    assert "AIzaSECRET" not in message
    assert "abc123" not in message
    assert "[redacted]" in message
    await f.close()


async def test_unreadable_body_is_an_invalid_response() -> None:
    f = fetcher([("/x", httpx.Response(200, content=b"not-json"))])
    with pytest.raises(ProviderError) as excinfo:
        await f.get_json("https://api.example.com/x")
    assert excinfo.value.kind == "invalid_response"
    await f.close()


def test_safe_url_strips_query_strings() -> None:
    assert (
        safe_url("https://x.example/v1/tracks?api_key=SECRET&b=2") == "https://x.example/v1/tracks"
    )


async def test_request_gate_spaces_calls() -> None:
    gate = RequestGate(gap_ms=30)
    started: list[float] = []

    async def one() -> None:
        await gate.wait()
        started.append(asyncio.get_running_loop().time())

    await asyncio.gather(one(), one())
    assert started[1] - started[0] >= 0.02


def test_dedupe_by_id_keeps_the_first() -> None:
    class Row:
        def __init__(self, id: str) -> None:  # noqa: A002
            self.id = id

    out = dedupe_by_id([Row("a"), Row("b"), Row("a"), Row("c")])
    assert [r.id for r in out] == ["a", "b", "c"]
