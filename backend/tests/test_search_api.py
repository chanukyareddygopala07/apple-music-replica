"""`/api/search` orchestration: grouping, language truth table, isolation."""

from __future__ import annotations

import httpx

from tests.conftest import api, make_settings

AUDIUS_TRACK = {
    "id": "D7Kydh5n",
    "title": "Sunset Drive",
    "duration": 213.4,
    "is_streamable": True,
    "user": {"id": "user-1", "name": "Nova Lane"},
}
JAMENDO_TRACK = {
    "id": "1848357",
    "name": "Coastal Light",
    "duration": 180.0,
    "position": 1,
    "audio": "https://prod-1.storage.jamendo.com/?trackid=1848357&format=mp32",
    "album_id": "555",
    "album_name": "Open Skies",
    "artist_id": "77",
    "artist_name": "Mira Cole",
}
YOUTUBE_ITEM = {
    "id": {"videoId": "dQw4w9WgXcQ"},
    "snippet": {"title": "Ocean Echo", "channelId": "UC1", "channelTitle": "Blue Room"},
}

AUDIUS_OK = (r"/v1/tracks/search", httpx.Response(200, json={"data": [AUDIUS_TRACK]}))
JAMENDO_OK = (
    r"/v3\.0/tracks",
    httpx.Response(200, json={"headers": {"status": "success"}, "results": [JAMENDO_TRACK]}),
)
YOUTUBE_OK = (
    r"/youtube/v3/search",
    httpx.Response(200, json={"items": [YOUTUBE_ITEM]}),
)
YOUTUBE_VIDEOS_OK = (
    r"/youtube/v3/videos",
    httpx.Response(200, json={"items": []}),
)


def groups_by_source(payload: dict) -> dict[str, dict]:
    return {group["source"]: group for group in payload["groups"]}


async def test_all_returns_one_honest_group_per_source() -> None:
    async with api([AUDIUS_OK, JAMENDO_OK, YOUTUBE_OK, YOUTUBE_VIDEOS_OK]) as (client, _):
        response = await client.get("/api/search", params={"q": "sunset"})
    assert response.status_code == 200
    payload = response.json()

    # camelCase contract the TypeScript facade consumes.
    assert payload["query"] == "sunset"
    assert payload["language"] == "all"
    assert payload["source"] == "all"

    sources = {group["source"] for group in payload["groups"]}
    assert sources == {"audius", "jamendo"}  # YouTube never blends into `all`
    assert payload["hiddenSources"] == []

    audius = groups_by_source(payload)["audius"]
    song = audius["results"]["songs"][0]
    assert song["id"] == "au-song-D7Kydh5n"
    assert song["durationMs"] == 213400
    assert song["audioUrl"].endswith("/tracks/D7Kydh5n/stream")
    assert song["source"] == "audius"

    jamendo = groups_by_source(payload)["jamendo"]
    assert jamendo["results"]["songs"][0]["id"] == "jm-song-1848357"
    assert jamendo["results"]["songs"][0]["attribution"] == "Jamendo"
    assert audius["status"] == "ok"
    assert jamendo["status"] == "ok"


async def test_explicit_youtube_source_is_served_only_when_asked() -> None:
    routes = [YOUTUBE_OK, YOUTUBE_VIDEOS_OK, AUDIUS_OK, JAMENDO_OK]
    async with api(routes) as (client, calls):
        payload = (
            await client.get("/api/search", params={"q": "ocean", "source": "youtube"})
        ).json()
    assert [g["source"] for g in payload["groups"]] == ["youtube"]
    assert payload["groups"][0]["results"]["songs"][0]["playbackKind"] == "youtube"
    # The API key travels on our outbound call only.
    search_calls = [c for c in calls if "/youtube/v3/search" in str(c.url)]
    assert search_calls and search_calls[0].url.params["key"]
    text = payload
    assert "AIzaTESTKEY" not in str(text)


async def test_language_hides_sources_that_cannot_apply_it() -> None:
    """Audius has no language parameter — it must be named, never faked."""
    async with api([AUDIUS_OK, JAMENDO_OK]) as (client, calls):
        payload = (await client.get("/api/search", params={"q": "sunset", "language": "fr"})).json()
    assert payload["hiddenSources"] == ["audius"]
    assert [g["source"] for g in payload["groups"]] == ["jamendo"]

    jamendo_call = next(c for c in calls if "jamendo" in str(c.url))
    assert jamendo_call.url.params["lang"] == "fr"
    audius_calls = [c for c in calls if "audius" in str(c.url)]
    assert audius_calls == []  # never queried when it cannot apply the filter


async def test_a_language_without_an_iso_code_hides_every_filtering_source() -> None:
    async with api([AUDIUS_OK, JAMENDO_OK]) as (client, calls):
        payload = (await client.get("/api/search", params={"q": "x", "language": "other"})).json()
    assert set(payload["hiddenSources"]) == {"audius", "jamendo"}
    assert payload["groups"] == []
    assert calls == []


async def test_all_language_sends_no_filter_parameter() -> None:
    async with api([AUDIUS_OK, JAMENDO_OK]) as (client, calls):
        await client.get("/api/search", params={"q": "x", "language": "all", "source": "jamendo"})
    call = next(c for c in calls if "jamendo" in str(c.url))
    assert "lang" not in call.url.params


async def test_one_failing_source_never_removes_another() -> None:
    routes = [
        (r"/v1/tracks/search", httpx.Response(500, json={"message": "boom"})),
        JAMENDO_OK,
    ]
    async with api(routes) as (client, _):
        payload = (await client.get("/api/search", params={"q": "x"})).json()
    groups = groups_by_source(payload)
    assert groups["audius"]["status"] == "error"
    assert "Search failed" in groups["audius"]["message"]
    assert groups["jamendo"]["status"] == "ok"
    assert groups["jamendo"]["results"]["songs"]


async def test_timeout_produces_a_typed_error_group() -> None:
    routes = [
        (r"/v1/tracks/search", httpx.ConnectTimeout("slow")),
        JAMENDO_OK,
    ]
    async with api(routes) as (client, _):
        payload = (await client.get("/api/search", params={"q": "x"})).json()
    assert (
        groups_by_source(payload)["audius"]["message"]
        == "Search failed: The provider did not respond in time."
    )


async def test_rate_limited_source_reports_rate_limiting() -> None:
    routes = [
        (r"/v1/tracks/search", httpx.Response(429)),
        JAMENDO_OK,
    ]
    async with api(routes) as (client, _):
        payload = (await client.get("/api/search", params={"q": "x"})).json()
    assert "rate limiting" in groups_by_source(payload)["audius"]["message"].lower()


async def test_unconfigured_single_source_answers_honestly() -> None:
    settings = make_settings(JAMENDO_CLIENT_ID="", YOUTUBE_API_KEY="")
    async with api([], settings=settings) as (client, calls):
        payload = (await client.get("/api/search", params={"q": "x", "source": "jamendo"})).json()
    assert payload["groups"][0]["status"] == "unconfigured"
    assert "JAMENDO_CLIENT_ID" in payload["groups"][0]["message"]
    assert calls == []


async def test_search_results_are_cached_per_query() -> None:
    hits = {"n": 0}

    def counting(request: httpx.Request) -> httpx.Response:
        hits["n"] += 1
        return httpx.Response(
            200, json={"headers": {"status": "success"}, "results": [JAMENDO_TRACK]}
        )

    async with api([(r"/v3\.0/tracks", counting)]) as (client, _):
        first = await client.get("/api/search", params={"q": "coastal", "source": "jamendo"})
        second = await client.get("/api/search", params={"q": "coastal", "source": "jamendo"})
    assert first.status_code == second.status_code == 200
    assert hits["n"] == 1  # second call served from the TTL cache


async def test_different_languages_are_cached_separately() -> None:
    hits = {"n": 0}

    def counting(request: httpx.Request) -> httpx.Response:
        hits["n"] += 1
        return httpx.Response(200, json={"headers": {"status": "success"}, "results": []})

    async with api([(r"/v3\.0/tracks", counting)]) as (client, _):
        await client.get("/api/search", params={"q": "x", "source": "jamendo", "language": "en"})
        await client.get("/api/search", params={"q": "x", "source": "jamendo", "language": "fr"})
        await client.get("/api/search", params={"q": "x", "source": "jamendo", "language": "en"})
    assert hits["n"] == 2


async def test_invalid_requests_are_rejected_loudly() -> None:
    async with api([]) as (client, calls):
        assert (await client.get("/api/search", params={"q": "   "})).status_code == 422
        assert (await client.get("/api/search", params={"q": "x" * 500})).status_code == 422
        assert (
            await client.get("/api/search", params={"q": "x", "language": "zz"})
        ).status_code == 422
        assert (
            await client.get("/api/search", params={"q": "x", "source": "demo"})
        ).status_code == 422
        assert (
            await client.get("/api/search", params={"q": "x", "cursor": "../etc/passwd"})
        ).status_code == 422
        assert (await client.get("/api/search", params={"q": "x", "limit": "0"})).status_code == 422
    assert calls == []  # nothing upstream was ever contacted


async def test_error_responses_never_leak_server_secrets() -> None:
    routes = [
        (r"/v1/tracks/search", httpx.Response(500, json={"message": "api_key=AIzaLEAKED failed"})),
    ]
    async with api(routes) as (client, _):
        payload = (await client.get("/api/search", params={"q": "x"})).json()
    assert "AIzaLEAKED" not in str(payload)
    assert "[redacted]" in str(payload)


async def test_upstream_redirects_are_not_followed() -> None:
    routes = [
        (
            r"/v1/tracks/search",
            httpx.Response(302, headers={"Location": "https://evil.example.com/hook"}),
        ),
    ]
    async with api(routes) as (client, _):
        payload = (await client.get("/api/search", params={"q": "x"})).json()
    assert groups_by_source(payload)["audius"]["status"] == "error"
