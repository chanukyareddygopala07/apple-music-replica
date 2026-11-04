"""YouTube discovery adapter (Data API v3) — search metadata only.

Playback never happens here: videos play through the **official visible IFrame
player** on `/watch` in the frontend. This module only does what the API
documents — `search.list` (embeddable videos) plus one cheap `videos.list`
for durations, made-for-kids status and the declared audio language.

Policy notes carried over from the frontend:

- Results appear only under the dedicated YouTube source (never blended into
  other providers' lists) — that grouping decision lives in the service layer.
- `relevanceLanguage` is a relevance *hint* applied by YouTube's servers, not
  a language verification, so tracks are never relabelled as language-matched.
- The API key is a server credential: sent in the ``x-goog-api-key`` header
  on our calls — never in a query URL, never echoed back, never logged.
"""

from __future__ import annotations

import re
from html import unescape
from typing import Any

import httpx

from app.cache import TTLCache, cache_miss
from app.config import YoutubeSettings
from app.languages import track_language, youtube_language
from app.models.schemas import Album, Artist, Track, TrackDetail
from app.providers.base import (
    HttpFetcher,
    ProviderError,
    ProviderPage,
    RequestGate,
    dedupe_by_id,
)

YT_SONG = "yt-"
YT_ARTIST = "yt-artist-"
YT_ALBUM = "yt-album-"

_VIDEO_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")
_HTTP_URL = re.compile(r"^https?://", re.IGNORECASE)


def is_video_id(raw: str | None) -> bool:
    return bool(raw and _VIDEO_ID.match(raw))


def youtube_video_id(domain_id: str) -> str | None:
    """Video id from a domain song id; rejects `yt-artist-*` / `yt-album-*`."""
    if not domain_id.startswith(YT_SONG):
        return None
    if domain_id.startswith(YT_ARTIST) or domain_id.startswith(YT_ALBUM):
        return None
    raw = domain_id[len(YT_SONG) :]
    return raw if raw else None


def watch_url(video_id: str) -> str:
    return f"https://www.youtube.com/watch?v={video_id}"


def _str(value: Any) -> str | None:
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


def _http_url(value: Any) -> str | None:
    url = _str(value)
    return url if url and _HTTP_URL.match(url) else None


def decode_entities(value: str) -> str:
    """Snippets carry HTML entities (`&#39;`, `&amp;` …) — decode once."""
    return unescape(value)


def parse_iso8601_duration(value: str | None) -> int:
    """`PT1H2M3S` → milliseconds; 0 when unparsable."""
    if not value:
        return 0
    match = re.match(
        r"^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$",
        value,
    )
    if not match:
        return 0
    days, hours, minutes, seconds = (int(g) if g else 0 for g in match.groups())
    return ((days * 24 + hours) * 3600 + minutes * 60 + seconds) * 1000


def best_thumbnail(snippet: dict[str, Any] | None) -> str | None:
    """maxres → standard → high → medium → default."""
    thumbs = snippet.get("thumbnails") if isinstance(snippet, dict) else None
    if not isinstance(thumbs, dict):
        return None
    for key in ("maxres", "standard", "high", "medium", "default"):
        url = _http_url(thumbs.get(key).get("url") if isinstance(thumbs.get(key), dict) else None)
        if url:
            return url
    return None


def to_track(
    snippet: dict[str, Any] | None,
    *,
    video_id: str,
    duration_ms: int = 0,
    language: str | None = None,
) -> Track | None:
    if not snippet or not is_video_id(video_id):
        return None
    title = _str(snippet.get("title"))
    if not title:
        return None
    channel_id = _str(snippet.get("channelId")) or ""
    # `videos.list` snippets carry `defaultAudioLanguage` (the uploader's
    # declared audio language); `search.list` snippets do not, so search
    # passes the value collected from the companion videos.list lookup.
    # Absent or unmappable → no language, never a guess.
    declared = language if language is not None else _str(snippet.get("defaultAudioLanguage"))
    app_language = track_language(declared)
    return Track(
        id=f"{YT_SONG}{video_id}",
        title=decode_entities(title),
        album_id=f"{YT_ALBUM}{video_id}",
        artist_ids=[f"{YT_ARTIST}{channel_id}"] if channel_id else [],
        duration_ms=max(0, duration_ms),
        track_number=0,
        audio_url="",  # never routed through the <audio> engine
        artwork_url=best_thumbnail(snippet),
        source="youtube",
        playback_kind="youtube",
        external_url=watch_url(video_id),
        language=app_language,
        language_status="verified" if app_language else None,
    )


def to_artist(channel_id: str, title: str | None) -> Artist | None:
    name = decode_entities(title.strip()) if title else ""
    if not channel_id or not name:
        return None
    return Artist(
        id=f"{YT_ARTIST}{channel_id}",
        name=name,
        artwork_seed=f"yt-artist-{channel_id}",  # no avatar is invented
        genre_ids=[],
    )


def album_from_track(track: Track, published_at: str | None) -> Album:
    """Single-video "album" so song/album pages resolve for YouTube songs."""
    return Album(
        id=track.album_id,
        title=track.title,
        artist_id=track.artist_ids[0] if track.artist_ids else f"{YT_ARTIST}unknown",
        artwork_seed=track.artwork_url or track.album_id,
        release_date=_str(published_at) or "",
        genre_ids=[],
        kind="single",
        song_ids=[track.id],
    )


class YoutubeProvider:
    """`search.list` + `videos.list`. Discovery only; playback stays in the UI."""

    source = "youtube"
    name = "YouTube"

    def __init__(
        self,
        settings: YoutubeSettings,
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
            message = self.settings.message or "YouTube search is not configured."
            raise ProviderError("unconfigured", message)

    def _headers(self) -> dict[str, str]:
        """Credential as a header — Google's documented ``x-goog-api-key``."""
        return {"x-goog-api-key": self.settings.api_key or ""}

    async def _request(self, path: str, params: dict[str, Any]) -> dict[str, Any]:
        self._require_configured()
        url = f"{self.settings.base_url}/{path.lstrip('/')}"
        # Cache key is params-only: the credential rides in a header, so it is
        # absent from the URL, the cache key, and anything logged.
        key = f"youtube:{path}:{sorted(params.items())}"
        hit = self.cache.get(key)
        if hit is not cache_miss():
            return hit
        body = await self._fetcher.get_json(url, params, headers=self._headers())
        if not isinstance(body, dict):
            raise ProviderError("invalid_response", "YouTube sent an unreadable response.")
        self.cache.set(key, body)
        return body

    async def search(
        self,
        query: str,
        *,
        language: str = "all",
        limit: int = 10,
        cursor: str | None = None,
    ) -> ProviderPage:
        params: dict[str, Any] = {
            "part": "snippet",
            "type": "video",
            "videoEmbeddable": "true",
            "q": query,
            "maxResults": limit,
        }
        if cursor:
            params["pageToken"] = cursor
        relevance = youtube_language(language) if language != "all" else None
        if relevance:
            params["relevanceLanguage"] = relevance

        body = await self._request("search", params)
        raw_items = body.get("items")
        items = [i for i in raw_items if isinstance(i, dict)] if isinstance(raw_items, list) else []
        video_ids: list[str] = []
        for item in items:
            item_id = item.get("id")
            video_id = item_id.get("videoId") if isinstance(item_id, dict) else None
            if isinstance(video_id, str) and is_video_id(video_id):
                video_ids.append(video_id)

        # One cheap videos.list for durations, made-for-kids and the declared
        # audio language; a failure must never fail the search (rows then show
        # no duration and no language).
        durations: dict[str, int] = {}
        languages: dict[str, str] = {}
        try:
            videos = await self._videos(video_ids)
            for video in videos:
                video_id = video.get("id")
                if isinstance(video_id, str):
                    content = video.get("contentDetails")
                    duration = content.get("duration") if isinstance(content, dict) else None
                    parsed = parse_iso8601_duration(duration if isinstance(duration, str) else None)
                    durations[video_id] = parsed
                    v_snippet = video.get("snippet")
                    declared = (
                        _str(v_snippet.get("defaultAudioLanguage"))
                        if isinstance(v_snippet, dict)
                        else None
                    )
                    if declared:
                        languages[video_id] = declared
        except ProviderError:
            durations = {}
            languages = {}

        tracks: list[Track] = []
        artists: list[Artist] = []
        for item, video_id in zip(items, video_ids, strict=False):
            snippet = item.get("snippet") if isinstance(item.get("snippet"), dict) else None
            track = to_track(
                snippet,
                video_id=video_id,
                duration_ms=durations.get(video_id, 0),
                language=languages.get(video_id),
            )
            if not track:
                continue
            tracks.append(track)
            channel_id = track.artist_ids[0][len(YT_ARTIST) :] if track.artist_ids else ""
            channel_title = _str(snippet.get("channelTitle")) if snippet else None
            artist = to_artist(channel_id, channel_title)
            if artist:
                artists.append(artist)

        next_token = body.get("nextPageToken")
        return ProviderPage(
            tracks=dedupe_by_id(tracks),
            artists=dedupe_by_id(artists),
            albums=[],
            playlists=[],
            cursor=next_token if isinstance(next_token, str) and next_token else None,
        )

    async def _videos(self, video_ids: list[str]) -> list[dict[str, Any]]:
        if not video_ids:
            return []
        body = await self._request(
            "videos",
            {"part": "snippet,contentDetails,status", "id": ",".join(video_ids[:50])},
        )
        items = body.get("items")
        return [i for i in items if isinstance(i, dict)] if isinstance(items, list) else []

    async def get_track(self, raw_id: str) -> TrackDetail | None:
        """Video detail for the watch page (metadata + made-for-kids status)."""
        video_id = youtube_video_id(raw_id) or (raw_id if is_video_id(raw_id) else None)
        if not is_video_id(video_id):
            return None
        assert video_id is not None
        key = f"youtube:video:{video_id}"
        hit = self.cache.get(key)
        if hit is not cache_miss():
            return hit
        videos = await self._videos([video_id])
        if not videos:
            self.cache.set(key, None, negative=True)
            return None
        video = videos[0]
        snippet = video.get("snippet") if isinstance(video.get("snippet"), dict) else None
        details = video.get("contentDetails")
        content = details if isinstance(details, dict) else None
        status = video.get("status") if isinstance(video.get("status"), dict) else None
        duration = content.get("duration") if content else None
        track = to_track(
            snippet,
            video_id=video_id,
            duration_ms=parse_iso8601_duration(duration if isinstance(duration, str) else None),
        )
        if track is None:
            self.cache.set(key, None, negative=True)
            return None
        channel_id = track.artist_ids[0][len(YT_ARTIST) :] if track.artist_ids else ""
        artist = to_artist(channel_id, _str(snippet.get("channelTitle")) if snippet else None)
        album = album_from_track(track, _str(snippet.get("publishedAt")) if snippet else None)
        made_for_kids = status.get("madeForKids") if status else None
        detail = TrackDetail(
            track=track,
            artists=[artist] if artist else [],
            albums=[album],
            playlists=[],
            made_for_kids=made_for_kids if isinstance(made_for_kids, bool) else None,
        )
        self.cache.set(key, detail)
        return detail
