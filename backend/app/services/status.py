"""Provider status payloads shared by `/api/health` and `/api/providers`."""

from __future__ import annotations

from app.config import Settings
from app.models.schemas import ProviderCapabilities, ProviderInfo


def provider_infos(settings: Settings) -> list[ProviderInfo]:
    """Honest, secret-free status for every server-side source."""
    return [
        ProviderInfo(
            id="audius",
            name="Audius",
            description="Free public catalogue: search, charts and real streamed audio.",
            configured=settings.audius.configured,
            status="ready"
            if settings.audius.configured
            else ("disabled" if not settings.audius.enabled else "unconfigured"),
            message=settings.audius.message,
            capabilities=ProviderCapabilities(search=True, language_filter=False, playback="audio"),
        ),
        ProviderInfo(
            id="jamendo",
            name="Jamendo",
            description="Creative Commons catalogue with per-track licences (client id required).",
            configured=settings.jamendo.configured,
            status="ready"
            if settings.jamendo.configured
            else ("disabled" if not settings.jamendo.enabled else "unconfigured"),
            message=settings.jamendo.message,
            capabilities=ProviderCapabilities(search=True, language_filter=True, playback="audio"),
        ),
        ProviderInfo(
            id="youtube",
            name="YouTube",
            description=(
                "Video discovery via the YouTube Data API; playback uses the official visible "
                "embedded player (API key required for search only)."
            ),
            configured=settings.youtube.configured,
            status="ready"
            if settings.youtube.configured
            else ("disabled" if not settings.youtube.enabled else "unconfigured"),
            message=settings.youtube.message,
            capabilities=ProviderCapabilities(
                search=True, language_filter=True, playback="video-embed"
            ),
        ),
    ]
