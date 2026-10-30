"""Search orchestration: capability gating, bounded fan-out, error isolation.

One source's failure never takes down another's results — each source answers
in its own group with an honest status, exactly the contract the frontend's
`GroupedSearchResults` already renders.

Language policy (mirrors `src/data/sources.ts`):

- A source is **hidden** (not queried) when it cannot apply the requested
  language honestly: Audius has no language parameter at all, and Jamendo /
  YouTube can only filter with a real ISO 639-1 value (`other` has none).
- `all` means no filter: every configured remote source answers.
- YouTube is **excluded from `all`** (dedicated `?src=youtube` view only) —
  it is queried when explicitly requested, never blended with other sources.

What this API deliberately does *not* serve: the demo catalogue (local to the
browser so the app works with no server at all) and MusicKit (Apple's SDK runs
in the page). Both stay frontend-side.
"""

from __future__ import annotations

import asyncio
from typing import Literal

from app.config import Settings
from app.languages import ALL_LANGUAGES, language_by_code, normalize_language
from app.models.schemas import (
    CatalogSource,
    GroupedSearchResponse,
    SearchGroup,
    SearchResults,
)
from app.providers.audius import AudiusProvider
from app.providers.base import ProviderError, ProviderPage
from app.providers.jamendo import JamendoProvider
from app.providers.youtube import YoutubeProvider

RemoteSource = Literal["audius", "jamendo", "youtube"]
RemoteSourceFilter = Literal["audius", "jamendo", "youtube", "all"]

SOURCE_NAMES: dict[str, str] = {
    "audius": "Audius",
    "jamendo": "Jamendo",
    "youtube": "YouTube",
}

#: Sources merged into `all` — YouTube is deliberately not among them.
ALL_SOURCES: tuple[RemoteSource, ...] = ("audius", "jamendo")


def source_supports_language(source: str, language: str) -> bool:
    """True only when the provider has a documented parameter to apply it."""
    if language == ALL_LANGUAGES:
        return True
    option = language_by_code(language)
    if source in ("jamendo", "youtube"):
        return bool(option and option.iso)
    if source == "audius":
        return False
    return False


class SearchService:
    def __init__(
        self,
        settings: Settings,
        *,
        audius: AudiusProvider,
        jamendo: JamendoProvider,
        youtube: YoutubeProvider,
    ) -> None:
        self.settings = settings
        self._semaphore = asyncio.Semaphore(max(1, settings.max_concurrent_sources))
        self._providers: dict[RemoteSource, AudiusProvider | JamendoProvider | YoutubeProvider] = {
            "audius": audius,
            "jamendo": jamendo,
            "youtube": youtube,
        }

    def _configured(self, source: str) -> bool:
        if source == "audius":
            return self.settings.audius.configured
        if source == "jamendo":
            return self.settings.jamendo.configured
        if source == "youtube":
            return self.settings.youtube.configured
        return False

    async def search(
        self,
        query: str,
        *,
        language: str = ALL_LANGUAGES,
        source: RemoteSourceFilter = "all",
        cursor: str | None = None,
        limit: int | None = None,
    ) -> GroupedSearchResponse:
        language = normalize_language(language)
        requested: list[RemoteSource] = list(ALL_SOURCES) if source == "all" else [source]

        eligible: list[RemoteSource] = []
        hidden: list[CatalogSource] = []
        for item in requested:
            if source_supports_language(item, language):
                eligible.append(item)
            else:
                hidden.append(item)  # named in the UI, never silently dropped

        groups = await asyncio.gather(
            *(self._guarded(item, query, language, cursor, limit) for item in eligible)
        )
        ordered = [g for g in groups if g is not None]
        return GroupedSearchResponse(
            query=query,
            language=language,
            source=source,
            groups=ordered,
            hidden_sources=hidden,
        )

    async def _guarded(
        self,
        source: RemoteSource,
        query: str,
        language: str,
        cursor: str | None,
        limit: int | None,
    ) -> SearchGroup:
        """Bounded fan-out: at most `MAX_CONCURRENT_SOURCES` sources at once."""
        async with self._semaphore:
            return await self._run_source(source, query, language, cursor, limit)

    async def _run_source(
        self,
        source: RemoteSource,
        query: str,
        language: str,
        cursor: str | None,
        limit: int | None,
    ) -> SearchGroup:
        name = SOURCE_NAMES[source]
        if not self._configured(source):
            message = self.settings.provider_messages.get(source) or (
                f"{name} is not configured on this server."
            )
            return SearchGroup(
                source=source,
                name=name,
                status="unconfigured",
                message=message,
                results=SearchResults(query=query),
            )
        try:
            page = await self._query(source, query, language, cursor, limit)
        except ProviderError as exc:
            return SearchGroup(
                source=source,
                name=name,
                status="error",
                message=f"Search failed: {exc.message}",
                results=SearchResults(query=query),
            )
        except Exception:  # noqa: BLE001 - one source must never break the rest
            return SearchGroup(
                source=source,
                name=name,
                status="error",
                message="Search failed: the provider did not answer.",
                results=SearchResults(query=query),
            )
        results = SearchResults(
            query=query,
            songs=page.tracks,
            albums=page.albums,
            artists=page.artists,
            playlists=page.playlists,
        )
        return SearchGroup(
            source=source,
            name=name,
            status="ok" if results.total else "empty",
            results=results,
            cursor=page.cursor,
        )

    async def _query(
        self,
        source: RemoteSource,
        query: str,
        language: str,
        cursor: str | None,
        limit: int | None,
    ) -> ProviderPage:
        provider = self._providers[source]
        page_limit = limit or self.settings.search_limit
        if source == "audius":
            return await provider.search(query, limit=page_limit)  # type: ignore[union-attr]
        if source == "jamendo":
            return await provider.search(  # type: ignore[union-attr]
                query, language=language, limit=page_limit, cursor=cursor
            )
        return await provider.search(  # type: ignore[union-attr]
            query, language=language, limit=page_limit, cursor=cursor
        )
