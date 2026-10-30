"""Jamendo adapter — free Creative Commons catalogue (needs a client id).

Mirrors `src/data/jamendo-normalize.ts`: ids, single-album handling, licence
attribution and the track's stated lyrics language. Documents what the API
actually supports — playlists, stations and genre pages are not invented.

- The client id is a server credential here: it is sent on our outbound calls
  and never echoed into a response.
- Results stream Jamendo's documented ``audio`` URL from the browser; the app
  plays the stream and links the licence, it never downloads or redistributes.
- `lang` (Jamendo's documented 2-letter code) is applied by Jamendo's servers;
  a language without an ISO value never reaches the request (the caller gates).
"""

from __future__ import annotations

import re
from typing import Any

import httpx

from app.cache import TTLCache, cache_miss
from app.config import JamendoSettings
from app.languages import jamendo_language
from app.models.schemas import Album, Artist, Track, TrackDetail
from app.providers.base import (
    HttpFetcher,
    ProviderError,
    ProviderPage,
    RequestGate,
    dedupe_by_id,
)

JM_SONG = "jm-song-"
JM_ARTIST = "jm-artist-"
JM_ALBUM = "jm-album-"
JM_ALBUM_SINGLE = "jm-album-t-"

_HTTP_URL = re.compile(r"^https?://", re.IGNORECASE)
_LANG = re.compile(r"^[a-z]{2}$", re.IGNORECASE)

TRACK_DEFAULTS: dict[str, Any] = {
    "format": "json",
    "type": "single albumtrack",
    "audioformat": "mp32",
    "imagesize": "600",
    "include": "licenses musicinfo",
}


def _str(value: Any) -> str | None:
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


def _num(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)) and value == value:
        return float(value)
    if isinstance(value, str) and value.strip():
        try:
            return float(value)
        except ValueError:
            return None
    return None


def _http_url(value: Any) -> str | None:
    url = _str(value)
    return url if url and _HTTP_URL.match(url) else None


def raw_track_id(domain_id: str) -> str | None:
    """Accept `jm-song-{id}` (domain) or the raw Jamendo id."""
    raw = domain_id[len(JM_SONG) :] if domain_id.startswith(JM_SONG) else domain_id
    if not raw or len(raw) > 64 or not raw.isalnum():
        return None
    return raw


def lyric_language(raw: dict[str, Any] | None) -> str | None:
    """Stated lyrics language (ISO 639-1) — only when the track says so."""
    info = raw.get("musicinfo") if isinstance(raw, dict) else None
    value = info.get("lang") if isinstance(info, dict) else None
    if isinstance(value, str) and _LANG.match(value.strip()):
        return value.strip().lower()
    return None


def to_artist(raw: dict[str, Any] | None) -> Artist | None:
    if not raw:
        return None
    artist_id = _str(raw.get("artist_id"))
    if not artist_id:
        return None
    return Artist(
        id=f"{JM_ARTIST}{artist_id}",
        name=_str(raw.get("artist_name")) or "Jamendo Artist",
        artwork_seed=_http_url(raw.get("image") or raw.get("album_image"))
        or f"{JM_ARTIST}{artist_id}",
        genre_ids=[],
    )


def to_track(raw: dict[str, Any] | None) -> Track | None:
    """A track without an `audio` stream URL is dropped (the row must play)."""
    if not raw:
        return None
    track_id = _str(raw.get("id"))
    audio = _http_url(raw.get("audio"))
    if not track_id or not audio or not _str(raw.get("name")):
        return None
    artist = to_artist(raw)
    album_id = _str(raw.get("album_id"))
    duration = _num(raw.get("duration")) or 0.0
    position = _num(raw.get("position")) or 0.0
    language = lyric_language(raw)
    return Track(
        id=f"{JM_SONG}{track_id}",
        title=_str(raw.get("name")) or "Untitled",
        album_id=f"{JM_ALBUM}{album_id}" if album_id else f"{JM_ALBUM_SINGLE}{track_id}",
        artist_ids=[artist.id] if artist else [],
        duration_ms=max(0, round(duration * 1000)),
        track_number=int(position),
        audio_url=audio,
        artwork_url=_http_url(raw.get("image") or raw.get("album_image")),
        source="jamendo",
        playback_kind="audio",
        external_url=_http_url(raw.get("shareurl")),
        attribution="Jamendo",
        attribution_url=_http_url(raw.get("license_ccurl")),
        language=language,
        language_status="verified" if language else None,
    )


def album_from_track(raw: dict[str, Any] | None) -> Album | None:
    """Real album surfaced from an album-track row (details load on demand)."""
    if not raw:
        return None
    album_id = _str(raw.get("album_id"))
    if not album_id:
        return None
    artist = to_artist(raw)
    return Album(
        id=f"{JM_ALBUM}{album_id}",
        title=_str(raw.get("album_name")) or "Album",
        artist_id=artist.id if artist else f"{JM_ARTIST}unknown",
        artwork_seed=_http_url(raw.get("album_image") or raw.get("image"))
        or f"{JM_ALBUM}{album_id}",
        release_date=_str(raw.get("releasedate")) or "",
        genre_ids=[],
        kind="album",
        song_ids=[],
    )


class JamendoProvider:
    """Track search with the documented `lang` filter + single-track lookup."""

    source = "jamendo"
    name = "Jamendo"

    def __init__(
        self,
        settings: JamendoSettings,
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

    @property
    def configured(self) -> bool:
        return self.settings.configured

    def _require_configured(self) -> None:
        if not self.settings.configured:
            message = self.settings.message or "Jamendo is not configured."
            raise ProviderError("unconfigured", message)

    def _params(self, params: dict[str, Any]) -> dict[str, Any]:
        return {"client_id": self.settings.client_id, **params}

    async def _tracks(
        self, params: dict[str, Any], *, negative_key: str | None = None
    ) -> list[dict[str, Any]]:
        self._require_configured()
        url = f"{self.settings.base_url}/tracks"
        if negative_key:
            hit = self.cache.get(negative_key)
            if hit is not cache_miss():
                return hit
        key = f"jamendo:tracks:{sorted(self._params(params).items())}"
        hit = self.cache.get(key)
        if hit is not cache_miss():
            return hit
        body = await self._fetcher.get_json(url, self._params({**TRACK_DEFAULTS, **params}))
        results = self._envelope_results(body)
        self.cache.set(key, results)
        return results

    @staticmethod
    def _envelope_results(body: Any) -> list[dict[str, Any]]:
        """Jamendo reports API failures in the envelope even on HTTP 200."""
        if not isinstance(body, dict):
            raise ProviderError("invalid_response", "Jamendo sent an unreadable response.")
        headers = body.get("headers")
        status = headers.get("status") if isinstance(headers, dict) else None
        if status != "success":
            detail = headers.get("error_message") if isinstance(headers, dict) else None
            message = detail.strip() if isinstance(detail, str) and detail.strip() else None
            raise ProviderError("http", message or "Jamendo reported an API error.")
        results = body.get("results")
        if not isinstance(results, list):
            raise ProviderError("invalid_response", "Jamendo sent an unreadable response.")
        return [item for item in results if isinstance(item, dict)]

    async def search(
        self,
        query: str,
        *,
        language: str = "all",
        limit: int = 10,
        cursor: str | None = None,
    ) -> ProviderPage:
        offset = 0
        if cursor and cursor.isdigit():
            offset = int(cursor)
        params: dict[str, Any] = {"limit": limit, "offset": offset, "search": query}
        lang = jamendo_language(language) if language != "all" else None
        if lang:
            params["lang"] = lang
        params["order"] = "relevance"  # required alongside a text search
        raws = await self._tracks(params)

        tracks = [t for t in (to_track(raw) for raw in raws) if t is not None]
        artists = [a for a in (to_artist(raw) for raw in raws) if a is not None]
        albums = [a for a in (album_from_track(raw) for raw in raws) if a is not None]
        next_cursor = str(offset + limit) if len(raws) >= limit else None
        return ProviderPage(
            tracks=dedupe_by_id(tracks),
            artists=dedupe_by_id(artists),
            albums=dedupe_by_id(albums),
            playlists=[],  # not part of the Jamendo read surface — never invented
            cursor=next_cursor,
        )

    async def get_track(self, raw_id: str) -> TrackDetail | None:
        self._require_configured()
        negative_key = f"jamendo:track:{raw_id}"
        raws = await self._tracks({"id": raw_id, "limit": 1}, negative_key=negative_key)
        if not raws:
            self.cache.set(negative_key, [], negative=True)
            return None
        raw = raws[0]
        track = to_track(raw)
        if track is None:
            self.cache.set(negative_key, [], negative=True)
            return None
        artist = to_artist(raw)
        album = album_from_track(raw)
        return TrackDetail(
            track=track,
            artists=[artist] if artist else [],
            albums=[album] if album else [],
            playlists=[],  # Jamendo exposes no playlists here — never invent one
        )
