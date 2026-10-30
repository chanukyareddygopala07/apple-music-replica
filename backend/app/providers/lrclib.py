"""LRCLIB lyrics adapter — free, open lyrics database (no API key).

Research notes (lrclib.net/docs, checked against the live docs):

- Anonymous access is allowed; identify the client with a ``User-Agent``
  naming the application (we do — see ``USER_AGENT``).
- Rate limits are generous (~45–90 requests/min per IP for anonymous clients)
  but the API requires clients to honour ``Retry-After`` on ``429``; the
  shared ``HttpFetcher`` already does exactly one retry with that delay.
- ``GET /api/get`` matches on track name + artist name, and — crucially —
  on duration within ±2 seconds when provided. We always send the duration.
- ``404`` means "no match"; it is an ordinary outcome, cached briefly so a
  track without lyrics is not re-queried on every playback.

Rights: LRCLIB is a free and open lyrics database built for this kind of
display. The UI links attribution back to LRCLIB whenever remote lyrics are
shown, and lyrics are displayed (never redistributed as a dataset).
"""

from __future__ import annotations

from typing import Any

import httpx

from app.cache import TTLCache, cache_miss
from app.config import LrclibSettings
from app.models.schemas import LyricsResponse
from app.providers.base import HttpFetcher, ProviderError, RequestGate

USER_AGENT = "Realaxify/0.1.0 (https://github.com/chanukyareddygopala07/apple-music-replica)"
ATTRIBUTION_URL = "https://lrclib.net"


def _str(value: Any) -> str | None:
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


class LrclibProvider:
    """Track-signature lookup (``/api/get``) with caching and honest 404s."""

    source = "lrclib"
    name = "LRCLIB"

    def __init__(
        self,
        settings: LrclibSettings,
        client: httpx.AsyncClient,
        *,
        timeout_s: float,
        gap_ms: int,
        cache: TTLCache[Any],
    ) -> None:
        self.settings = settings
        self.cache = cache
        self._fetcher = HttpFetcher(
            client,
            allowed_host=httpx.URL(settings.base_url).host,
            timeout_s=timeout_s,
            gate=RequestGate(gap_ms),
        )
        # Politeness: LRCLIB asks for a short delay between sequential calls.
        self._client = client

    @property
    def configured(self) -> bool:
        return self.settings.configured

    def _require_configured(self) -> None:
        if not self.settings.configured:
            raise ProviderError(
                "unconfigured", self.settings.message or "Lyrics lookup is disabled."
            )

    def _params(
        self, track_name: str, artist_name: str, album_name: str | None, duration_s: int | None
    ) -> dict[str, Any]:
        params: dict[str, Any] = {"track_name": track_name, "artist_name": artist_name}
        if album_name:
            params["album_name"] = album_name
        if duration_s is not None:
            params["duration"] = duration_s
        return params

    async def lookup(
        self,
        *,
        track_name: str,
        artist_name: str,
        album_name: str | None = None,
        duration_s: int | None = None,
    ) -> LyricsResponse:
        self._require_configured()
        params = self._params(track_name, artist_name, album_name, duration_s)
        key = f"lrclib:get:{sorted(params.items())}"
        hit = self.cache.get(key)
        if hit is not cache_miss():
            return hit

        url = f"{self.settings.base_url}/api/get"
        try:
            body = await self._fetcher.get_json(
                url, params, headers={"User-Agent": USER_AGENT, "Accept": "application/json"}
            )
        except ProviderError as exc:
            if exc.status_code == 404:
                response = LyricsResponse(
                    found=False, source="lrclib", attribution_url=ATTRIBUTION_URL
                )
                self.cache.set(key, response, negative=True)
                return response
            raise

        response = self._to_response(body)
        self.cache.set(key, response)
        return response

    @staticmethod
    def _to_response(body: Any) -> LyricsResponse:
        if not isinstance(body, dict):
            raise ProviderError(
                "invalid_response", "The lyrics provider sent an unreadable response."
            )
        plain = _str(body.get("plainLyrics"))
        synced = _str(body.get("syncedLyrics"))
        instrumental = body.get("instrumental") is True
        record_id = body.get("id")
        return LyricsResponse(
            found=bool(plain or synced or instrumental),
            source="lrclib",
            record_id=record_id if isinstance(record_id, int) else None,
            instrumental=instrumental,
            plain_lyrics=plain,
            synced_lyrics=synced,
            attribution_name="LRCLIB",
            attribution_url=ATTRIBUTION_URL,
        )
