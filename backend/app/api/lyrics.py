"""`GET /api/lyrics` — LRCLIB lookup by track signature.

The frontend already knows the song's title, artist byline, album and
duration, so it sends that signature here; the backend does the polite,
cached, rate-limit-aware call to LRCLIB and returns lyrics plus attribution.

A missing track is a normal answer (`found: false`), not an error — the UI
shows its "no lyrics" state and remembers it.
"""

from __future__ import annotations

import re

from fastapi import APIRouter, HTTPException, Query, Request

from app.models.schemas import LyricsResponse
from app.providers.base import ProviderError
from app.providers.lrclib import LrclibProvider

router = APIRouter(tags=["lyrics"])

_NAME = re.compile(r"^[^<>]{1,200}$")


@router.get(
    "/lyrics",
    response_model=LyricsResponse,
    summary="Look up lyrics for a track signature",
    response_model_exclude_none=True,
)
async def lyrics(
    request: Request,
    track_name: str = Query(..., min_length=1, description="Track title (required by LRCLIB)."),
    artist_name: str = Query(..., min_length=1, description="Artist byline (required by LRCLIB)."),
    album_name: str | None = Query(
        None, max_length=200, description="Album title (improves matching)."
    ),
    duration: int | None = Query(
        None, ge=1, le=3600, description="Track duration in seconds (LRCLIB matches within ±2s)."
    ),
) -> LyricsResponse:
    settings = request.app.state.settings
    if not settings.lrclib.configured:
        raise HTTPException(
            status_code=503, detail=settings.lrclib.message or "Lyrics lookup is unavailable."
        )
    for label, value in (
        ("track_name", track_name),
        ("artist_name", artist_name),
        ("album_name", album_name),
    ):
        if value is not None and not _NAME.match(value):
            raise HTTPException(status_code=422, detail=f"Invalid {label}.")

    provider: LrclibProvider = request.app.state.lrclib
    try:
        return await provider.lookup(
            track_name=track_name.strip(),
            artist_name=artist_name.strip(),
            album_name=album_name.strip() if album_name else None,
            duration_s=duration,
        )
    except ProviderError as exc:
        if exc.kind == "timeout":
            raise HTTPException(status_code=504, detail=exc.message) from None
        if exc.kind == "rate_limited":
            raise HTTPException(status_code=429, detail=exc.message) from None
        raise HTTPException(status_code=502, detail=exc.message) from None
    except Exception:  # noqa: BLE001 - never leak internals
        raise HTTPException(status_code=502, detail="The lyrics provider did not answer.") from None
