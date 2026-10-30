"""`/api/lyrics` — LRCLIB signature lookup, caching, honest misses."""

from __future__ import annotations

import httpx

from tests.conftest import api, make_settings

LRCLIB_RECORD = {
    "id": 3396226,
    "trackName": "Coastal Light",
    "artistName": "Mira Cole",
    "albumName": "Open Skies",
    "duration": 180,
    "instrumental": False,
    "hasWordSync": False,
    "plainLyrics": "Line one\nLine two\n",
    "syncedLyrics": "[00:01.00] Line one\n[00:05.50] Line two\n",
}

SIGNATURE = {"track_name": "Coastal Light", "artist_name": "Mira Cole", "duration": "180"}


async def test_found_lyrics_are_returned_with_attribution() -> None:
    routes = [(r"lrclib\.net/api/get", httpx.Response(200, json=LRCLIB_RECORD))]
    async with api(routes) as (client, calls):
        payload = (await client.get("/api/lyrics", params=SIGNATURE)).json()

    assert payload["found"] is True
    assert payload["source"] == "lrclib"
    assert payload["recordId"] == 3396226
    assert payload["syncedLyrics"].startswith("[00:01.00]")
    assert payload["plainLyrics"].startswith("Line one")
    assert payload["attributionName"] == "LRCLIB"
    assert payload["attributionUrl"] == "https://lrclib.net"

    request = calls[0]
    assert request.url.params["track_name"] == "Coastal Light"
    assert request.url.params["artist_name"] == "Mira Cole"
    assert request.url.params["duration"] == "180"
    # Client identification is required by LRCLIB's docs.
    assert "Realaxify" in request.headers["User-Agent"]


async def test_lrclib_404_is_an_ordinary_miss_not_an_error() -> None:
    routes = [
        (
            r"lrclib\.net/api/get",
            httpx.Response(
                404, json={"message": "Failed to find specified track", "name": "TrackNotFound"}
            ),
        )
    ]
    async with api(routes) as (client, _):
        response = await client.get("/api/lyrics", params=SIGNATURE)
    assert response.status_code == 200
    assert response.json() == {
        "found": False,
        "source": "lrclib",
        "instrumental": False,
        "attributionUrl": "https://lrclib.net",
    }


async def test_misses_are_cached_briefly_and_hits_are_not_refetched() -> None:
    hits = {"n": 0}

    def counting(request: httpx.Request) -> httpx.Response:
        hits["n"] += 1
        return httpx.Response(200, json=LRCLIB_RECORD)

    async with api([(r"lrclib\.net/api/get", counting)]) as (client, _):
        first = await client.get("/api/lyrics", params=SIGNATURE)
        second = await client.get("/api/lyrics", params=SIGNATURE)
    assert first.json() == second.json()
    assert hits["n"] == 1


async def test_instrumental_records_are_reported_honestly() -> None:
    record = {**LRCLIB_RECORD, "instrumental": True, "plainLyrics": None, "syncedLyrics": None}
    routes = [(r"lrclib\.net/api/get", httpx.Response(200, json=record))]
    async with api(routes) as (client, _):
        payload = (await client.get("/api/lyrics", params=SIGNATURE)).json()
    assert payload["found"] is True
    assert payload["instrumental"] is True
    assert "plainLyrics" not in payload  # absent = None, excluded


async def test_disabled_lyrics_lookup_returns_503_with_the_reason() -> None:
    async with api([], settings=make_settings(LYRICS_ENABLED="0")) as (client, calls):
        response = await client.get("/api/lyrics", params=SIGNATURE)
    assert response.status_code == 503
    assert "LYRICS_ENABLED" in response.json()["detail"]
    assert calls == []


async def test_invalid_signatures_are_rejected_before_any_upstream_call() -> None:
    async with api([]) as (client, calls):
        assert (
            await client.get(
                "/api/lyrics", params={"track_name": "x", "artist_name": "y", "duration": "0"}
            )
        ).status_code == 422
        assert (
            await client.get(
                "/api/lyrics", params={"track_name": "x", "artist_name": "y", "duration": "4000"}
            )
        ).status_code == 422
        assert (
            await client.get("/api/lyrics", params={"track_name": "x" * 500, "artist_name": "y"})
        ).status_code == 422
        assert (
            await client.get("/api/lyrics", params={"track_name": "<script>", "artist_name": "y"})
        ).status_code == 422
    assert calls == []


async def test_rate_limits_surface_as_429_and_timeouts_as_504() -> None:
    async with api([(r"lrclib\.net/api/get", httpx.Response(429))]) as (client, _):
        assert (await client.get("/api/lyrics", params=SIGNATURE)).status_code == 429
    async with api([(r"lrclib\.net/api/get", httpx.ReadTimeout("slow"))]) as (client, _):
        assert (await client.get("/api/lyrics", params=SIGNATURE)).status_code == 504


async def test_upstream_failures_never_leak_into_lyrics_payloads() -> None:
    routes = [
        (
            r"lrclib\.net/api/get",
            httpx.Response(500, json={"message": "internal key=SECRET value"}),
        )
    ]
    async with api(routes) as (client, _):
        response = await client.get("/api/lyrics", params=SIGNATURE)
    assert response.status_code == 502
    assert "SECRET" not in response.text
