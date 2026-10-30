"""Realaxify API — FastAPI application factory.

Layering, kept deliberately small:

- ``app/api``        — HTTP: validation, status codes, response models.
- ``app/services``   — orchestration (search fan-out, provider status).
- ``app/providers``  — one adapter per external service, all I/O inside.
- ``app/models``     — the Pydantic contract the TypeScript frontend consumes.
- ``app/cache.py``   — bounded in-memory TTL cache (no external infrastructure).

Run locally:  ``uvicorn app.main:app --reload --port 8000`` (from ``backend/``).
"""

from __future__ import annotations

import logging
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api import health, lyrics, providers, search, tracks
from app.cache import TTLCache
from app.config import Settings, load_settings
from app.providers.audius import AudiusProvider
from app.providers.jamendo import JamendoProvider
from app.providers.lrclib import LrclibProvider
from app.providers.youtube import YoutubeProvider
from app.services.search import SearchService

logger = logging.getLogger("realaxify.api")

MAX_QUERY_STRING = 4096
MAX_BODY_BYTES = 16 * 1024


def create_app(
    settings: Settings | None = None, *, transport: httpx.AsyncBaseTransport | None = None
) -> FastAPI:
    """Build the app. ``transport`` exists so tests never touch the network."""
    cfg = settings or load_settings()
    logging.basicConfig(
        level=getattr(logging, cfg.log_level.upper(), logging.INFO),
        format="%(levelname)s %(name)s %(message)s",
    )

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        client = httpx.AsyncClient(transport=transport, follow_redirects=False)
        cache: TTLCache = TTLCache(
            max_entries=cfg.cache_max_entries,
            ttl_s=cfg.cache_ttl_s,
            negative_ttl_s=cfg.cache_negative_ttl_s,
        )
        common = {"timeout_s": cfg.http_timeout_s, "gap_ms": cfg.request_gap_ms, "cache": cache}
        audius = AudiusProvider(cfg.audius, client, **common)
        jamendo = JamendoProvider(cfg.jamendo, client, **common)
        youtube = YoutubeProvider(cfg.youtube, client, **common)
        lrclib = LrclibProvider(cfg.lrclib, client, **common)
        app.state.settings = cfg
        app.state.client = client
        app.state.cache = cache
        app.state.audius = audius
        app.state.jamendo = jamendo
        app.state.youtube = youtube
        app.state.lrclib = lrclib
        app.state.search_service = SearchService(
            cfg, audius=audius, jamendo=jamendo, youtube=youtube
        )
        app.state.started_at = time.monotonic()
        try:
            yield
        finally:
            await client.aclose()

    app = FastAPI(
        title="Realaxify API",
        summary="Multilingual music discovery and search orchestration.",
        version=cfg.version,
        lifespan=lifespan,
    )
    app.state.settings = cfg

    # Narrow CORS: explicit origins only, no credentials (nothing here is cookie-authenticated).
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(cfg.cors_origins),
        allow_credentials=False,
        allow_methods=["GET", "OPTIONS"],
        allow_headers=["Accept", "Content-Type"],
        max_age=600,
    )

    @app.middleware("http")
    async def request_limits(request: Request, call_next):  # noqa: ANN001
        if len(request.url.query) > MAX_QUERY_STRING:
            return JSONResponse({"detail": "Query string too long."}, status_code=414)
        content_length = request.headers.get("content-length")
        if content_length and content_length.isdigit() and int(content_length) > MAX_BODY_BYTES:
            return JSONResponse({"detail": "Request body too large."}, status_code=413)
        return await call_next(request)

    @app.exception_handler(HTTPException)
    async def http_error(request: Request, exc: HTTPException) -> JSONResponse:  # noqa: ARG001
        return JSONResponse({"detail": str(exc.detail)}, status_code=exc.status_code)

    @app.exception_handler(Exception)
    async def unexpected_error(request: Request, exc: Exception) -> JSONResponse:  # noqa: ARG001
        # Log server-side with no request payload; the client gets a bare 500.
        logger.exception("Unhandled error on %s", request.url.path)
        return JSONResponse({"detail": "Internal server error."}, status_code=500)

    prefix = cfg.api_prefix
    app.include_router(health.router, prefix=prefix)
    app.include_router(providers.router, prefix=prefix)
    app.include_router(search.router, prefix=prefix)
    app.include_router(tracks.router, prefix=prefix)
    app.include_router(lyrics.router, prefix=prefix)
    return app


app = create_app()
