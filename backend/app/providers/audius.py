"""Audius adapter — free public API, anonymous access by default.

Mirrors `src/data/audius-normalize.ts` (ids, artwork preference, playability
filters) so both sides of the stack produce the same domain objects.

Deliberate decisions:

- The **stream URL** points at Audius's documented `/tracks/{id}/stream`
  endpoint; the browser's `<audio>` element follows the 302 itself. Media is
  never proxied or re-hosted by this server.
- A server-side ``AUDIUS_API_KEY`` (if any) is sent on *our* outbound API
  calls only — it is never echoed into a response body or a stream URL.
- Tracks that are deleted, unlisted, unstreamable or stream-gated are
  dropped so every result row can actually play.
"""

from __future__ import annotations

import re
from datetime import datetime
from typing import Any

import httpx

from app.cache import TTLCache, cache_miss
from app.config import AudiusSettings
from app.models.schemas import Album, Artist, Playlist, Track, TrackDetail
from app.providers.base import (
    HttpFetcher,
    ProviderError,
    ProviderPage,
    RequestGate,
    dedupe_by_id,
)

AU_SONG = "au-song-"
AU_ARTIST = "au-artist-"
AU_ALBUM_TRACK = "au-album-t-"
AU_PLAYLIST = "au-playlist-"

_ARTWORK_PREFERENCE = ("1000x1000", "480x480", "150x150", "_1000x1000", "_480x480", "_150x150")
_ARTWORK_URL = re.compile(r"^https?://", re.IGNORECASE)


def _str(value: Any) -> str | None:
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


def _num(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)) and value == value:  # NaN-safe
        return float(value)
    if isinstance(value, str) and value.strip():
        try:
            return float(value)
        except ValueError:
            return None
    return None


def _record(value: Any) -> dict[str, Any] | None:
    return value if isinstance(value, dict) else None


def artwork_url(artwork: Any) -> str | None:
    """Largest available remote artwork (http(s) only)."""
    record = _record(artwork)
    if not record:
        return None
    for key in _ARTWORK_PREFERENCE:
        url = _str(record.get(key))
        if url and _ARTWORK_URL.match(url):
            return url
    return None


def is_playable(raw: dict[str, Any] | None) -> bool:
    """Drop tracks Audius itself marks as unplayable."""
    if not raw or not _str(raw.get("id")):
        return False
    if raw.get("is_delete") is True:
        return False
    if raw.get("is_unlisted") is True:
        return False
    return raw.get("is_streamable") is not False and raw.get("is_stream_gated") is not True


def to_artist(raw: dict[str, Any] | None) -> Artist | None:
    if not raw:
        return None
    user_id = _str(raw.get("id"))
    if not user_id:
        return None
    picture = artwork_url(raw.get("profile_picture") or raw.get("profile_pic"))
    return Artist(
        id=f"{AU_ARTIST}{user_id}",
        name=_str(raw.get("name")) or _str(raw.get("handle")) or "Audius Artist",
        artwork_seed=picture or f"au-user-{user_id}",
        bio=_str(raw.get("bio")),
        genre_ids=[],
    )


def raw_track_id(domain_id: str) -> str | None:
    """Accept `au-song-{id}` (domain) or the raw Audius id."""
    raw = domain_id[len(AU_SONG) :] if domain_id.startswith(AU_SONG) else domain_id
    return raw if raw and len(raw) <= 64 else None


def stream_url(settings: AudiusSettings, track_id: str) -> str:
    """Public streaming endpoint. No credentials in the URL — ever."""
    return f"{settings.base_url}/tracks/{track_id}/stream"


def to_track(settings: AudiusSettings, raw: dict[str, Any] | None) -> Track | None:
    if not is_playable(raw):
        return None
    assert raw is not None
    track_id = _str(raw.get("id"))
    if not track_id:
        return None
    artist = to_artist(_record(raw.get("user")))
    duration = _num(raw.get("duration")) or 0.0
    return Track(
        id=f"{AU_SONG}{track_id}",
        title=_str(raw.get("title")) or "Untitled",
        album_id=f"{AU_ALBUM_TRACK}{track_id}",
        artist_ids=[artist.id] if artist else [],
        duration_ms=max(0, round(duration * 1000)),
        track_number=0,
        audio_url=stream_url(settings, track_id),
        artwork_url=artwork_url(raw.get("artwork")),
        source="audius",
        playback_kind="audio",
    )


def album_from_track(settings: AudiusSettings, raw: dict[str, Any] | None) -> Album | None:
    """Single-track album synthesised per track (Audius has no album search)."""
    if not is_playable(raw):
        return None
    assert raw is not None
    track_id = _str(raw.get("id"))
    if not track_id:
        return None
    artist = to_artist(_record(raw.get("user")))
    return Album(
        id=f"{AU_ALBUM_TRACK}{track_id}",
        title=_str(raw.get("title")) or "Untitled",
        artist_id=artist.id if artist else f"{AU_ARTIST}unknown",
        artwork_seed=artwork_url(raw.get("artwork")) or f"{AU_ALBUM_TRACK}{track_id}",
        release_date=_str(raw.get("release_date")) or "",
        genre_ids=[],
        kind="single",
        song_ids=[f"{AU_SONG}{track_id}"],
    )


def playlist_content_ids(raw: dict[str, Any] | None) -> list[str]:
    if not raw:
        return []
    ids: list[str] = []
    contents = raw.get("playlist_contents")
    if isinstance(contents, list):
        for entry in contents:
            record = _record(entry)
            track_id = _str(record.get("track_id")) if record else None
            if track_id:
                ids.append(f"{AU_SONG}{track_id}")
    if not ids and isinstance(raw.get("tracks"), list):
        for track in raw["tracks"]:
            record = _record(track)
            track_id = _str(record.get("id")) if record else None
            if track_id:
                ids.append(f"{AU_SONG}{track_id}")
    return ids


def to_playlist(raw: dict[str, Any] | None) -> Playlist | None:
    if not raw:
        return None
    playlist_id = _str(raw.get("id"))
    if not playlist_id:
        return None
    user = _record(raw.get("user"))
    created_at = _epoch_ms(_str(raw.get("created_at")))
    return Playlist(
        id=f"{AU_PLAYLIST}{playlist_id}",
        title=_str(raw.get("playlist_name")) or _str(raw.get("title")) or "Playlist",
        description=_str(raw.get("description")) or "",
        artwork_seed=artwork_url(raw.get("artwork") or raw.get("cover_art"))
        or f"{AU_PLAYLIST}{playlist_id}",
        song_ids=playlist_content_ids(raw),
        is_user_playlist=False,
        curator=(_str(user.get("name")) or _str(user.get("handle"))) if user else None,
        created_at=created_at,
    )


def _epoch_ms(raw: str | None) -> int | None:
    if not raw:
        return None
    try:
        return int(datetime.fromisoformat(raw.replace("Z", "+00:00")).timestamp() * 1000)
    except ValueError:
        return None


class AudiusProvider:
    """Search + single-track lookup; other read surfaces stay in the frontend."""

    source = "audius"
    name = "Audius"

    def __init__(
        self,
        settings: AudiusSettings,
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

    def _outbound(self, params: dict[str, Any]) -> dict[str, Any]:
        """Attach the optional key to OUR call only — never echoed back out."""
        if self.settings.api_key:
            return {**params, "api_key": self.settings.api_key}
        return params

    async def _get(self, path: str, params: dict[str, Any]) -> Any:
        url = f"{self.settings.base_url}{path}"
        key = f"audius:{path}:{sorted(params.items())}"
        hit = self.cache.get(key)
        if hit is not cache_miss():
            return hit
        body = await self._fetcher.get_json(url, self._outbound(params))
        self.cache.set(key, body)
        return body

    @staticmethod
    def _list(body: Any) -> list[dict[str, Any]]:
        data = body.get("data") if isinstance(body, dict) else None
        if isinstance(data, list):
            return [item for item in data if isinstance(item, dict)]
        return []

    async def search(self, query: str, *, limit: int = 20) -> ProviderPage:
        """Track search is required; artists and playlists degrade on their own."""
        raw_tracks = self._list(await self._get("/tracks/search", {"query": query, "limit": limit}))
        tracks = [t for t in (to_track(self.settings, raw) for raw in raw_tracks) if t is not None]

        users: list[dict[str, Any]] = []
        playlists: list[dict[str, Any]] = []
        try:
            users = self._list(await self._get("/users/search", {"query": query, "limit": 8}))
        except ProviderError:
            users = []
        try:
            page = await self._get("/playlists/search", {"query": query, "limit": 8})
            playlists = self._list(page)
        except ProviderError:
            playlists = []

        artists = [a for a in (to_artist(raw) for raw in users) if a is not None]
        found_playlists = [p for p in (to_playlist(raw) for raw in playlists) if p is not None]
        return ProviderPage(
            tracks=dedupe_by_id(tracks),
            artists=dedupe_by_id(artists),
            playlists=dedupe_by_id(found_playlists),
        )

    async def get_track(self, raw_id: str) -> TrackDetail | None:
        """Single track plus the entities it references (song page lookup)."""
        key = f"audius:track:{raw_id}"
        hit = self.cache.get(key)
        if hit is not cache_miss():
            return hit
        try:
            body = await self._get(f"/tracks/{raw_id}", {})
        except ProviderError as exc:
            if exc.status_code == 404:
                self.cache.set(key, None, negative=True)
                return None
            raise
        data = body.get("data") if isinstance(body, dict) else None
        raw = data if isinstance(data, dict) else None
        track = to_track(self.settings, raw)
        if track is None:
            self.cache.set(key, None, negative=True)
            return None
        artist = to_artist(_record((raw or {}).get("user")))
        album = album_from_track(self.settings, raw)
        detail = TrackDetail(
            track=track, artists=[artist] if artist else [], albums=[album] if album else []
        )
        self.cache.set(key, detail)
        return detail
