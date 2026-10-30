"""`GET /api/search` — grouped, per-source results for the frontend facade.

Contract notes:

- ``q`` and ``language`` are validated, never echoed back altered, and never
  translated or transliterated.
- ``source`` accepts the three server-side sources (plus ``all``); the demo
  catalogue and MusicKit are browser-side and rejected with a 422 so a client
  bug is loud instead of silently returning nothing.
- Per-source outcomes arrive as groups (``ok`` / ``empty`` / ``error`` /
  ``unconfigured``); one source failing never removes another's results.
"""

from __future__ import annotations

import re

from fastapi import APIRouter, HTTPException, Query, Request

from app.languages import language_by_code
from app.models.schemas import GroupedSearchResponse
from app.services.search import RemoteSourceFilter, SearchService

router = APIRouter(tags=["search"])

_CURSOR = re.compile(r"^[A-Za-z0-9_.\-+=]{0,128}$")


@router.get(
    "/search",
    response_model=GroupedSearchResponse,
    summary="Search one or more sources",
    response_model_exclude_none=True,
)
async def search(
    request: Request,
    q: str = Query(..., min_length=1, description="Raw search text (never translated)."),
    language: str = Query("all", description="App language code, or `all`."),
    source: RemoteSourceFilter = Query(
        "all", description="Source filter (`all` excludes YouTube)."
    ),
    cursor: str | None = Query(None, description="Opaque per-source page cursor."),
    limit: int | None = Query(None, ge=1, le=50, description="Page size per source."),
) -> GroupedSearchResponse:
    settings = request.app.state.settings

    query = q.strip()
    if not query:
        raise HTTPException(status_code=422, detail="Search query is empty.")
    if len(query) > settings.max_query_length:
        raise HTTPException(
            status_code=422,
            detail=f"Search query is longer than {settings.max_query_length} characters.",
        )
    if language_by_code(language) is None:
        raise HTTPException(status_code=422, detail=f"Unknown language code: {language}.")
    if cursor is not None and not _CURSOR.match(cursor):
        raise HTTPException(status_code=422, detail="Invalid cursor.")

    service: SearchService = request.app.state.search_service
    return await service.search(
        query,
        language=language,
        source=source,
        cursor=cursor,
        limit=limit,
    )
