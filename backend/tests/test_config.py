"""Configuration: honest defaults, env-only base URLs, clamped numbers."""

from __future__ import annotations

from app.config import DEFAULT_CORS, load_settings

from .conftest import TEST_ENV


def test_credentials_mark_providers_configured() -> None:
    settings = load_settings(TEST_ENV)
    assert settings.audius.configured  # anonymous access is legitimate
    assert settings.jamendo.configured
    assert settings.youtube.configured
    assert all(msg is None for msg in settings.provider_messages.values())


def test_missing_credentials_produce_honest_unconfigured_messages() -> None:
    settings = load_settings({})
    assert not settings.jamendo.configured
    assert not settings.youtube.configured
    assert "JAMENDO_CLIENT_ID" in settings.jamendo.message or ""  # type: ignore[operator]
    assert "YOUTUBE_API_KEY" in settings.youtube.message or ""  # type: ignore[operator]
    # Messages tell an operator exactly what to set — and nothing secret.
    assert "test-jamendo" not in (settings.jamendo.message or "")


def test_disabled_flag_is_opt_out() -> None:
    for value in ("0", "false", "no", "off", "FALSE"):
        settings = load_settings({"AUDIUS_ENABLED": value})
        assert not settings.audius.configured
        assert "AUDIUS_ENABLED=0" in (settings.audius.message or "")


def test_invalid_base_urls_fall_back_to_known_defaults() -> None:
    """Only environment-configured http(s) hosts are ever contacted (SSRF)."""
    for bad in ("file:///etc/passwd", "javascript:alert(1)", "ftp://x/", "https://"):
        settings = load_settings({"AUDIUS_BASE_URL": bad})
        assert settings.audius.base_url == "https://api.audius.co/v1"


def test_base_url_is_stripped_of_trailing_slash() -> None:
    settings = load_settings({"JAMENDO_BASE_URL": "https://proxy.internal/v3.0/"})
    assert settings.jamendo.base_url == "https://proxy.internal/v3.0"


def test_numbers_are_clamped_and_invalid_values_use_defaults() -> None:
    settings = load_settings(
        {"SEARCH_LIMIT": "0", "HTTP_TIMEOUT_S": "nonsense", "MAX_QUERY_LENGTH": "-5"}
    )
    assert settings.search_limit == 1
    assert settings.http_timeout_s == 8.0
    assert settings.max_query_length == 8  # minimum


def test_cors_origins_are_explicit_only() -> None:
    assert load_settings({}).cors_origins == DEFAULT_CORS
    parsed = load_settings({"CORS_ORIGINS": "https://a.example, https://b.example/ ,"}).cors_origins
    assert parsed == ("https://a.example", "https://b.example")
    # Wildcards are never accepted silently.
    assert load_settings({"CORS_ORIGINS": "*"}).cors_origins == ("*",)
