"""`GET /api/health` — liveness plus honest provider status."""

from __future__ import annotations

import time

from fastapi import APIRouter, Request

from app.models.schemas import HealthResponse
from app.services.status import provider_infos

router = APIRouter(tags=["meta"])


@router.get("/health", response_model=HealthResponse, summary="Service health")
async def health(request: Request) -> HealthResponse:
    settings = request.app.state.settings
    started_at: float = getattr(request.app.state, "started_at", time.monotonic())
    return HealthResponse(
        status="ok",
        service="realaxify-api",
        version=settings.version,
        uptime_seconds=round(max(0.0, time.monotonic() - started_at), 3),
        providers=provider_infos(settings),
    )
