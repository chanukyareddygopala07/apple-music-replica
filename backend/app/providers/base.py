"""Provider plumbing: typed errors, a throttling HTTP fetcher, page shape.

Rules this module enforces for every provider:

- **Timeouts** on every outbound call (never a hanging request).
- **A minimum gap** between calls to one provider (rate-limit politeness) and
  a single bounded retry on ``429`` honouring ``Retry-After``.
- **Secret-free errors**: upstream URLs are stripped to origin + path before
  they can reach a log or a response — credentials travel as query params for
  several providers and must never leak.
- **No arbitrary fetching**: the only hosts allowed are the configured base
  URLs, and redirects are not followed. Nothing in a request can change that.
"""

from __future__ import annotations

import asyncio
import json
import re
import time
from dataclasses import dataclass, field
from typing import Any, Literal
from urllib.parse import urlparse

import httpx

from app.models.schemas import Album, Artist, Playlist, Track

ErrorKind = Literal[
    "timeout", "rate_limited", "http", "invalid_response", "unconfigured", "unavailable"
]


class ProviderError(Exception):
    """A provider failure safe to surface to a client (never contains secrets)."""

    def __init__(
        self,
        kind: ErrorKind,
        message: str,
        *,
        retry_after: float | None = None,
        status_code: int | None = None,
    ) -> None:
        super().__init__(message)
        self.kind = kind
        self.message = message
        self.retry_after = retry_after
        self.status_code = status_code

    def __str__(self) -> str:  # pragma: no cover - trivial
        return self.message


def safe_url(url: str) -> str:
    """Origin + path only: query strings (api keys, client ids) are dropped."""
    parsed = urlparse(url)
    return f"{parsed.scheme}://{parsed.netloc}{parsed.path}"


def _retry_after_seconds(response: httpx.Response) -> float | None:
    raw = response.headers.get("Retry-After")
    if not raw:
        return None
    try:
        return max(0.0, min(2.0, float(raw)))
    except ValueError:
        return None


class RequestGate:
    """Serialises callers so one provider sees at most one request per gap."""

    def __init__(self, gap_ms: int) -> None:
        self._gap = max(0.0, gap_ms / 1000.0)
        self._lock = asyncio.Lock()
        self._next_at = 0.0

    async def wait(self) -> None:
        if self._gap <= 0:
            return
        async with self._lock:
            now = time.monotonic()
            delay = self._next_at - now
            if delay > 0:
                await asyncio.sleep(delay)
            self._next_at = time.monotonic() + self._gap


@dataclass
class ProviderPage:
    """Normalised search page for one provider."""

    tracks: list[Track] = field(default_factory=list)
    albums: list[Album] = field(default_factory=list)
    artists: list[Artist] = field(default_factory=list)
    playlists: list[Playlist] = field(default_factory=list)
    cursor: str | None = None


class HttpFetcher:
    """GET-only JSON fetcher with timeout, throttling, retry and sanitising."""

    def __init__(
        self,
        client: httpx.AsyncClient,
        *,
        allowed_host: str,
        timeout_s: float = 8.0,
        gate: RequestGate | None = None,
        max_retries: int = 1,
    ) -> None:
        self._client = client
        self._allowed_host = allowed_host
        self._timeout = timeout_s
        self._gate = gate or RequestGate(0)
        self._max_retries = max(0, max_retries)

    def _check_url(self, url: str) -> None:
        parsed = urlparse(url)
        if parsed.scheme not in {"http", "https"}:
            raise ProviderError("unavailable", "Blocked a non-http upstream request.")
        if parsed.netloc != self._allowed_host:
            # Defence in depth: only the configured provider host may be called.
            raise ProviderError("unavailable", "Blocked an unexpected upstream host.")

    async def get_json(
        self,
        url: str,
        params: dict[str, Any] | None = None,
        *,
        headers: dict[str, str] | None = None,
    ) -> Any:
        self._check_url(url)
        attempt = 0
        while True:
            await self._gate.wait()
            try:
                response = await self._client.get(
                    url,
                    params=params,
                    headers=headers,
                    timeout=self._timeout,
                    follow_redirects=False,
                )
            except httpx.TimeoutException as exc:
                raise ProviderError("timeout", "The provider did not respond in time.") from exc
            except httpx.HTTPError:
                raise ProviderError("unavailable", "The provider could not be reached.") from None

            if response.status_code == 429 and attempt < self._max_retries:
                attempt += 1
                delay = _retry_after_seconds(response) or 0.0
                if delay > 0:
                    await asyncio.sleep(delay)
                continue

            if response.status_code == 429:
                raise ProviderError("rate_limited", "The provider is rate limiting requests.")
            if response.status_code >= 400:
                raise ProviderError(
                    "http",
                    self._error_message(response),
                    status_code=response.status_code,
                )

            try:
                return response.json()
            except (json.JSONDecodeError, ValueError):
                raise ProviderError(
                    "invalid_response", "The provider sent an unreadable response."
                ) from None

    @staticmethod
    def _redact(text: str) -> str:
        """Strip anything credential-shaped from an upstream message."""
        pattern = r"(?i)\b(api[_-]?key|key|token|client[_-]?id|secret)=[^&\s]+"
        return re.sub(pattern, r"\1=[redacted]", text)

    def _error_message(self, response: httpx.Response) -> str:
        """Prefer the provider's own (redacted) message — quota errors matter."""
        try:
            body = response.json()
        except (json.JSONDecodeError, ValueError):
            return f"The provider returned HTTP {response.status_code}."
        message: str | None = None
        if isinstance(body, dict):
            error = body.get("error")
            if isinstance(error, dict) and isinstance(error.get("message"), str):
                message = error["message"].strip()
            elif isinstance(body.get("message"), str):
                message = body["message"].strip()
        if not message:
            headers = body.get("headers") if isinstance(body, dict) else None
            if isinstance(headers, dict) and isinstance(headers.get("error_message"), str):
                message = headers["error_message"].strip()
        if not message:
            return f"The provider returned HTTP {response.status_code}."
        return self._redact(message)[:300]

    async def close(self) -> None:
        await self._client.aclose()


def dedupe_by_id(items: list[Any]) -> list[Any]:
    """Drop duplicates inside one provider's page, keeping the first seen."""
    seen: set[str] = set()
    out: list[Any] = []
    for item in items:
        item_id = getattr(item, "id", None)
        if item_id is None or item_id not in seen:
            if item_id is not None:
                seen.add(item_id)
            out.append(item)
    return out
