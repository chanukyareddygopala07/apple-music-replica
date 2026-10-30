"""Shared fixtures: a fake upstream network and an app wired to it.

Nothing here ever touches the real network. Upstreams are answered by
``httpx.MockTransport`` with per-test route tables, and the app is entered
through its real lifespan so caches, providers and the search service are
wired exactly as in production.
"""

from __future__ import annotations

import re
from collections.abc import AsyncIterator, Callable, Sequence
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

import httpx
import pytest

from app.config import Settings, load_settings
from app.main import create_app

REPO_ROOT = Path(__file__).resolve().parents[2]

TEST_ENV: dict[str, str] = {
    "JAMENDO_CLIENT_ID": "test-jamendo-client-id",
    "YOUTUBE_API_KEY": "AIzaTESTKEY-not-real",
    "AUDIUS_ENABLED": "1",
    "PROVIDER_REQUEST_GAP_MS": "0",
    "HTTP_TIMEOUT_S": "2.0",
    "CACHE_TTL_S": "60",
    "LOG_LEVEL": "warning",
    "CORS_ORIGINS": "http://localhost:5173",
}

ResponseLike = httpx.Response | Exception | Callable[[httpx.Request], httpx.Response]


def make_settings(**overrides: str) -> Settings:
    """Settings built from a clean env plus per-test overrides."""
    return load_settings({**TEST_ENV, **overrides})


def make_transport(
    routes: Sequence[tuple[str, ResponseLike]], calls: list[httpx.Request]
) -> httpx.MockTransport:
    """Match upstream requests by regex over the full URL; record every call."""

    compiled = [(re.compile(pattern), value) for pattern, value in routes]

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        url = str(request.url)
        for pattern, value in compiled:
            if not pattern.search(url):
                continue
            if isinstance(value, Exception):
                raise value
            if callable(value):
                return value(request)
            return value
        return httpx.Response(404, json={"message": f"no test route for {url}"})

    return httpx.MockTransport(handler)


@asynccontextmanager
async def api(
    routes: Sequence[tuple[str, ResponseLike]] = (),
    *,
    settings: Settings | None = None,
) -> AsyncIterator[tuple[httpx.AsyncClient, list[httpx.Request]]]:
    """A live app instance backed by the fake upstreams.

    Yields ``(client, calls)`` where ``calls`` records every outbound request,
    so tests can assert on query params (language filters, credential use).
    """
    calls: list[httpx.Request] = []
    app = create_app(settings or make_settings(), transport=make_transport(routes, calls))
    async with app.router.lifespan_context(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
            yield client, calls


@pytest.fixture
def settings() -> Settings:
    return make_settings()


def json_body(request: httpx.Request) -> dict[str, Any]:
    """Decoded JSON body of an outbound request (for URL-encoded GETs)."""
    import json

    raw = request.content.decode() if request.content else ""
    if raw:
        return json.loads(raw)
    return {k: v for k, v in request.url.params.items()}
