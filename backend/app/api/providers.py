"""`GET /api/providers` — which server-side sources this deployment can search.

The frontend uses this to build its source selector when it is talking to the
API: a provider configured only on the server (the normal case for API keys)
still shows up honestly, and an unconfigured one carries the exact
environment variable it needs. Demo and MusicKit are browser-side and are
intentionally absent.
"""

from __future__ import annotations

from fastapi import APIRouter, Request

from app.models.schemas import ProvidersResponse
from app.services.status import provider_infos

router = APIRouter(tags=["meta"])


@router.get("/providers", response_model=ProvidersResponse, summary="Server-side provider status")
async def providers(request: Request) -> ProvidersResponse:
    return ProvidersResponse(providers=provider_infos(request.app.state.settings))
