"""Server-side configuration.

Every credential lives here — never in the browser bundle, never in a response
body, never in a log line. Base URLs are read from the environment only (never
from a request), which is what keeps the outbound client safe from SSRF.

Boolean flags are opt-OUT (`0/false/no/off` disables), mirroring the frontend's
`VITE_*` convention, with the two documented exceptions below.
"""

from __future__ import annotations

import os
from collections.abc import Mapping
from dataclasses import dataclass
from urllib.parse import urlparse

_TRUTHY = {"1", "true", "yes", "on"}
_FALSY = {"0", "false", "no", "off"}


def _flag(env: Mapping[str, str], name: str, default: bool) -> bool:
    raw = env.get(name)
    if raw is None or not raw.strip():
        return default
    value = raw.strip().lower()
    if value in _FALSY:
        return False
    if value in _TRUTHY:
        return True
    return default


def _int(env: Mapping[str, str], name: str, default: int, *, minimum: int = 0) -> int:
    raw = env.get(name, "").strip()
    if not raw:
        return default
    try:
        return max(minimum, int(raw))
    except ValueError:
        return default


def _float(env: Mapping[str, str], name: str, default: float, *, minimum: float = 0.0) -> float:
    raw = env.get(name, "").strip()
    if not raw:
        return default
    try:
        return max(minimum, float(raw))
    except ValueError:
        return default


def _url(env: Mapping[str, str], name: str, default: str) -> str:
    """Base URLs come from the environment only; reject anything non-http(s)."""
    raw = env.get(name, "").strip() or default
    parsed = urlparse(raw)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        return default
    return raw.rstrip("/")


def _credential(env: Mapping[str, str], name: str) -> str | None:
    raw = env.get(name, "").strip()
    return raw or None


@dataclass(frozen=True)
class AudiusSettings:
    enabled: bool
    api_key: str | None
    base_url: str

    @property
    def configured(self) -> bool:
        # Anonymous access is legitimate: Audius needs no key by default.
        return self.enabled

    @property
    def message(self) -> str | None:
        if self.enabled:
            return None
        return "Audius is disabled on this server (AUDIUS_ENABLED=0)."


@dataclass(frozen=True)
class JamendoSettings:
    enabled: bool
    client_id: str | None
    base_url: str

    @property
    def configured(self) -> bool:
        return self.enabled and bool(self.client_id)

    @property
    def message(self) -> str | None:
        if not self.enabled:
            return "Jamendo is disabled on this server (JAMENDO_ENABLED=0)."
        if not self.client_id:
            return (
                "Jamendo search needs a client id: set JAMENDO_CLIENT_ID on the server "
                "(free read-only id from devportal.jamendo.com)."
            )
        return None


@dataclass(frozen=True)
class LrclibSettings:
    enabled: bool
    base_url: str

    @property
    def configured(self) -> bool:
        # LRCLIB needs no credential — only the opt-out flag matters.
        return self.enabled

    @property
    def message(self) -> str | None:
        if self.enabled:
            return None
        return "Lyrics lookup is disabled on this server (LYRICS_ENABLED=0)."


@dataclass(frozen=True)
class YoutubeSettings:
    enabled: bool
    api_key: str | None
    base_url: str

    @property
    def configured(self) -> bool:
        return self.enabled and bool(self.api_key)

    @property
    def message(self) -> str | None:
        if not self.enabled:
            return "YouTube discovery is disabled on this server (YOUTUBE_ENABLED=0)."
        if not self.api_key:
            return (
                "YouTube search needs an API key on the server: set YOUTUBE_API_KEY "
                "(YouTube Data API v3, referrer-restricted). Playback never needs one."
            )
        return None


@dataclass(frozen=True)
class Settings:
    env: str
    api_prefix: str
    cors_origins: tuple[str, ...]
    version: str

    audius: AudiusSettings
    jamendo: JamendoSettings
    youtube: YoutubeSettings
    lrclib: LrclibSettings

    http_timeout_s: float
    cache_ttl_s: int
    cache_negative_ttl_s: int
    cache_max_entries: int
    request_gap_ms: int
    max_query_length: int
    search_limit: int
    max_concurrent_sources: int
    log_level: str

    @property
    def provider_messages(self) -> dict[str, str]:
        """Honest, secret-free status text per server-side source."""
        out: dict[str, str] = {}
        pairs = (("audius", self.audius), ("jamendo", self.jamendo), ("youtube", self.youtube))
        for source, cfg in pairs:
            message = cfg.message
            if message:
                out[source] = message
        return out


DEFAULT_CORS = (
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:4173",
    "http://127.0.0.1:4173",
)


def load_settings(env: Mapping[str, str] | None = None) -> Settings:
    e = os.environ if env is None else env

    origins = (
        tuple(
            part.strip().rstrip("/")
            for part in e.get("CORS_ORIGINS", "").split(",")
            if part.strip().rstrip("/")
        )
        or DEFAULT_CORS
    )

    return Settings(
        env=e.get("APP_ENV", e.get("ENV", "development")).strip() or "development",
        api_prefix="/api",
        cors_origins=origins,
        version="0.1.0",
        audius=AudiusSettings(
            enabled=_flag(e, "AUDIUS_ENABLED", True),
            api_key=_credential(e, "AUDIUS_API_KEY"),
            base_url=_url(e, "AUDIUS_BASE_URL", "https://api.audius.co/v1"),
        ),
        jamendo=JamendoSettings(
            enabled=_flag(e, "JAMENDO_ENABLED", True),
            client_id=_credential(e, "JAMENDO_CLIENT_ID"),
            base_url=_url(e, "JAMENDO_BASE_URL", "https://api.jamendo.com/v3.0"),
        ),
        youtube=YoutubeSettings(
            enabled=_flag(e, "YOUTUBE_ENABLED", True),
            api_key=_credential(e, "YOUTUBE_API_KEY"),
            base_url=_url(e, "YOUTUBE_BASE_URL", "https://www.googleapis.com/youtube/v3"),
        ),
        lrclib=LrclibSettings(
            enabled=_flag(e, "LYRICS_ENABLED", True),
            base_url=_url(e, "LRCLIB_BASE_URL", "https://lrclib.net"),
        ),
        http_timeout_s=_float(e, "HTTP_TIMEOUT_S", 8.0, minimum=0.5),
        cache_ttl_s=_int(e, "CACHE_TTL_S", 60),
        cache_negative_ttl_s=_int(e, "CACHE_NEGATIVE_TTL_S", 15),
        cache_max_entries=_int(e, "CACHE_MAX_ENTRIES", 512, minimum=1),
        request_gap_ms=_int(e, "PROVIDER_REQUEST_GAP_MS", 130),
        max_query_length=_int(e, "MAX_QUERY_LENGTH", 200, minimum=8),
        search_limit=_int(e, "SEARCH_LIMIT", 20, minimum=1),
        max_concurrent_sources=_int(e, "MAX_CONCURRENT_SOURCES", 4, minimum=1),
        log_level=e.get("LOG_LEVEL", "info").strip().lower() or "info",
    )
