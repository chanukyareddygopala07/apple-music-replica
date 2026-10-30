"""`GET /api/tracks/{provider}/{track_id}` — one track plus its entities.

The id is the domain id the frontend already uses (`au-song-…`,
`jm-song-…`, `yt-…`); the raw provider id is accepted too. Ids are strictly
validated before they can be part of an upstream URL.
"""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, HTTPException, Path, Request

from app.models.schemas import TrackDetail
from app.providers import audius as audius_provider
from app.providers import jamendo as jamendo_provider
from app.providers.base import ProviderError

router = APIRouter(tags=["tracks"])

ProviderName = Literal["audius", "jamendo", "youtube"]

_ID_PATTERN = r"^[A-Za-z0-9_-]{1,64}$"


@router.get(
    "/tracks/{provider}/{track_id}",
    response_model=TrackDetail,
    summary="Fetch a single track",
    response_model_exclude_none=True,
)
async def track(
    request: Request,
    provider: ProviderName = Path(..., description="Server-side provider id."),
    track_id: str = Path(..., pattern=_ID_PATTERN, description="Domain or raw provider track id."),
) -> TrackDetail:
    state = request.app.state

    if provider == "audius":
        if not state.settings.audius.configured:
            raise HTTPException(
                status_code=503, detail=state.settings.audius.message or "Audius unavailable."
            )
        raw_id = audius_provider.raw_track_id(track_id)
        if not raw_id:
            raise HTTPException(status_code=422, detail="Invalid Audius track id.")
        lookup = state.audius.get_track
    elif provider == "jamendo":
        if not state.settings.jamendo.configured:
            raise HTTPException(
                status_code=503, detail=state.settings.jamendo.message or "Jamendo unavailable."
            )
        raw_id = jamendo_provider.raw_track_id(track_id)
        if not raw_id:
            raise HTTPException(status_code=422, detail="Invalid Jamendo track id.")
        lookup = state.jamendo.get_track
    else:
        if not state.settings.youtube.configured:
            raise HTTPException(
                status_code=503, detail=state.settings.youtube.message or "YouTube unavailable."
            )
        raw_id = track_id
        lookup = state.youtube.get_track

    try:
        detail = await lookup(raw_id)
    except ProviderError as exc:
        raise HTTPException(status_code=_status_for(exc), detail=exc.message) from None
    except Exception:  # noqa: BLE001 - never leak internals to a client
        raise HTTPException(status_code=502, detail="The provider did not answer.") from None

    if detail is None:
        raise HTTPException(status_code=404, detail="Track not found.")
    return detail


def _status_for(exc: ProviderError) -> int:
    if exc.kind == "unconfigured":
        return 503
    if exc.kind == "timeout":
        return 504
    if exc.kind == "rate_limited":
        return 429
    return 502
