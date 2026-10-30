"""Pydantic request/response models — the stable Realaxify API contract.

Field names are snake_case in Python and serialise to the camelCase the
TypeScript frontend already uses (`src/domain/types.ts`), so a response can be
consumed without a translation layer. Optional provider metadata stays
optional: a source that does not supply a field gets ``null`` (omitted from
the JSON), never a fabricated value.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

CatalogSource = Literal["demo", "audius", "jamendo", "youtube", "musickit"]
SourceFilter = Literal["demo", "audius", "jamendo", "youtube", "musickit", "all"]
PlaybackKind = Literal["audio", "youtube"]
LanguageStatus = Literal["verified", "inferred", "unknown"]
SearchGroupStatus = Literal["ok", "empty", "error", "unconfigured", "disabled"]
ProviderStatus = Literal["ready", "unconfigured", "disabled"]
AlbumKind = Literal["album", "ep", "single"]


class ApiModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)


class Artist(ApiModel):
    id: str
    name: str
    artwork_seed: str
    bio: str | None = None
    genre_ids: list[str] = Field(default_factory=list)


class Album(ApiModel):
    id: str
    title: str
    artist_id: str
    artwork_seed: str
    release_date: str = ""
    genre_ids: list[str] = Field(default_factory=list)
    kind: AlbumKind = "album"
    song_ids: list[str] = Field(default_factory=list)
    copyright: str | None = None
    label: str | None = None
    description: str | None = None


class Track(ApiModel):
    """One playable result row (a `Song` in the frontend domain)."""

    id: str
    title: str
    album_id: str
    artist_ids: list[str] = Field(default_factory=list)
    duration_ms: int = 0
    track_number: int = 0
    audio_url: str = ""
    explicit: bool | None = None
    artwork_url: str | None = None
    source: CatalogSource
    playback_kind: PlaybackKind = "audio"
    external_url: str | None = None
    attribution: str | None = None
    attribution_url: str | None = None
    language: str | None = None
    language_status: LanguageStatus | None = None


class Playlist(ApiModel):
    id: str
    title: str
    description: str = ""
    artwork_seed: str
    song_ids: list[str] = Field(default_factory=list)
    is_user_playlist: bool = False
    curator: str | None = None
    created_at: int | None = None
    updated_at: int | None = None


class SearchResults(ApiModel):
    query: str
    songs: list[Track] = Field(default_factory=list)
    albums: list[Album] = Field(default_factory=list)
    artists: list[Artist] = Field(default_factory=list)
    playlists: list[Playlist] = Field(default_factory=list)

    @property
    def total(self) -> int:
        return len(self.songs) + len(self.albums) + len(self.artists) + len(self.playlists)


class SearchGroup(ApiModel):
    source: CatalogSource
    name: str
    status: SearchGroupStatus
    message: str | None = None
    results: SearchResults
    cursor: str | None = None


class GroupedSearchResponse(ApiModel):
    query: str
    language: str
    source: SourceFilter
    groups: list[SearchGroup] = Field(default_factory=list)
    hidden_sources: list[CatalogSource] = Field(default_factory=list)


class ProviderCapabilities(ApiModel):
    search: bool = True
    language_filter: bool = False
    playback: Literal["audio", "video-embed", "none"] = "audio"


class ProviderInfo(ApiModel):
    id: CatalogSource
    name: str
    description: str
    configured: bool
    status: ProviderStatus
    message: str | None = None
    capabilities: ProviderCapabilities = Field(default_factory=ProviderCapabilities)


class ProvidersResponse(ApiModel):
    providers: list[ProviderInfo]


class TrackDetail(ApiModel):
    """A track plus every entity it references (so the UI can render bylines)."""

    track: Track
    artists: list[Artist] = Field(default_factory=list)
    albums: list[Album] = Field(default_factory=list)
    playlists: list[Playlist] = Field(default_factory=list)
    #: YouTube only — `status.madeForKids` from `videos.list`. The UI embeds
    #: conservatively (privacy-enhanced mode) when this is ``None``/unknown
    #: (YouTube Developer Policies III.E.4.j).
    made_for_kids: bool | None = None


class HealthResponse(ApiModel):
    status: Literal["ok", "degraded"]
    service: str
    version: str
    uptime_seconds: float
    providers: list[ProviderInfo]


class LyricsResponse(ApiModel):
    """LRCLIB lookup result. `found: false` is an ordinary, cacheable outcome."""

    found: bool
    source: Literal["lrclib"] = "lrclib"
    record_id: int | None = None
    instrumental: bool = False
    plain_lyrics: str | None = None
    #: LRC-formatted (`[mm:ss.xx] line`) when the record is time-synced.
    synced_lyrics: str | None = None
    attribution_name: str | None = None
    attribution_url: str | None = None


class ErrorBody(ApiModel):
    detail: str
