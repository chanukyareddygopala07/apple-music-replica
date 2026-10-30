"""`/api/tracks/{provider}/{track_id}`: lookups, id validation, status codes."""

from __future__ import annotations

import httpx

from tests.conftest import api, make_settings

AUDIUS_TRACK = {
    "id": "D7Kydh5n",
    "title": "Sunset Drive",
    "duration": 213.4,
    "is_streamable": True,
    "user": {"id": "user-1", "name": "Nova Lane", "handle": "novalane"},
    "artwork": {"1000x1000": "https://creator.audius.co/x.jpg"},
}


async def test_audius_track_lookup_by_domain_id() -> None:
    routes = [(r"/v1/tracks/D7Kydh5n$", httpx.Response(200, json={"data": AUDIUS_TRACK}))]
    async with api(routes) as (client, calls):
        payload = (await client.get("/api/tracks/audius/au-song-D7Kydh5n")).json()

    assert payload["track"]["id"] == "au-song-D7Kydh5n"
    assert payload["track"]["durationMs"] == 213400
    assert payload["track"]["audioUrl"] == "https://api.audius.co/v1/tracks/D7Kydh5n/stream"
    assert payload["artists"][0]["name"] == "Nova Lane"
    assert payload["albums"][0]["kind"] == "single"
    assert "madeForKids" not in payload  # YouTube-only field stays absent

    # The domain prefix was stripped for the outbound call.
    assert any(str(c.url).endswith("/v1/tracks/D7Kydh5n") for c in calls)


async def test_audius_track_key_is_never_echoed_into_the_response() -> None:
    settings = make_settings(AUDIUS_API_KEY="SERVER-KEY")
    routes = [(r"/v1/tracks/D7Kydh5n$", httpx.Response(200, json={"data": AUDIUS_TRACK}))]
    async with api(routes, settings=settings) as (client, _):
        response = await client.get("/api/tracks/audius/au-song-D7Kydh5n")
    assert "SERVER-KEY" not in response.text
    assert "api_key" not in response.text


async def test_missing_track_is_404() -> None:
    async with api([(r"/v1/tracks/nope$", httpx.Response(404, json={"error": "not found"}))]) as (
        client,
        _,
    ):
        response = await client.get("/api/tracks/audius/au-song-nope")
    assert response.status_code == 404
    assert response.json()["detail"] == "Track not found."


async def test_invalid_track_ids_are_rejected_before_any_upstream_call() -> None:
    async with api([]) as (client, calls):
        for bad in ("au-song-..;rm", "jm-song-..x", "au-song-" + "x" * 200, "au-song-a b"):
            response = await client.get(f"/api/tracks/audius/{bad}")
            assert response.status_code == 422, bad
    assert calls == []


async def test_unconfigured_provider_returns_503_with_the_real_reason() -> None:
    settings = make_settings(YOUTUBE_API_KEY="")
    async with api([], settings=settings) as (client, calls):
        response = await client.get("/api/tracks/youtube/yt-dQw4w9WgXcQ")
    assert response.status_code == 503
    assert "YOUTUBE_API_KEY" in response.json()["detail"]
    assert calls == []


async def test_jamendo_lookup_accepts_both_id_shapes() -> None:
    body = {
        "headers": {"status": "success"},
        "results": [
            {
                "id": "1848357",
                "name": "Coastal Light",
                "duration": 180.0,
                "position": 1,
                "audio": "https://prod-1.storage.jamendo.com/?trackid=1848357&format=mp32",
                "album_id": "555",
                "album_name": "Open Skies",
                "artist_id": "77",
                "artist_name": "Mira Cole",
                "musicinfo": {"lang": "fr"},
            }
        ],
    }
    routes = [(r"/v3\.0/tracks", httpx.Response(200, json=body))]
    async with api(routes) as (client, calls):
        first = await client.get("/api/tracks/jamendo/jm-song-1848357")
        second = await client.get("/api/tracks/jamendo/1848357")  # raw id, same track
    payload = first.json()
    assert second.status_code == 200
    assert payload["track"]["id"] == "jm-song-1848357"
    assert payload["track"]["language"] == "fr"
    # Both shapes resolve to one upstream query (cache key uses the raw id).
    assert len(calls) == 1


async def test_jamendo_empty_result_is_404_and_cached_as_negative() -> None:
    hits = {"n": 0}

    def empty(request: httpx.Request) -> httpx.Response:
        hits["n"] += 1
        return httpx.Response(200, json={"headers": {"status": "success"}, "results": []})

    async with api([(r"/v3\.0/tracks", empty)]) as (client, _):
        assert (await client.get("/api/tracks/jamendo/jm-song-999")).status_code == 404
        assert (await client.get("/api/tracks/jamendo/jm-song-999")).status_code == 404
    assert hits["n"] == 1  # negative cache honoured


async def test_youtube_lookup_reports_made_for_kids() -> None:
    body = {
        "items": [
            {
                "id": "dQw4w9WgXcQ",
                "snippet": {
                    "title": "Ocean Echo",
                    "channelId": "UC1",
                    "channelTitle": "Blue Room",
                    "publishedAt": "2024-01-01T00:00:00Z",
                    "thumbnails": {
                        "default": {"url": "https://i.ytimg.com/vi/dQw4w9WgXcQ/default.jpg"}
                    },
                },
                "contentDetails": {"duration": "PT3M33S"},
                "status": {"madeForKids": False},
            }
        ]
    }
    routes = [(r"/youtube/v3/videos", httpx.Response(200, json=body))]
    async with api(routes) as (client, _):
        payload = (await client.get("/api/tracks/youtube/yt-dQw4w9WgXcQ")).json()
    assert payload["madeForKids"] is False
    assert payload["track"]["playbackKind"] == "youtube"
    assert payload["track"]["durationMs"] == 213000
    assert payload["track"]["audioUrl"] == ""  # video never enters the <audio> engine


async def test_rate_limited_lookup_maps_to_429() -> None:
    routes = [(r"/v1/tracks/D7Kydh5n$", httpx.Response(429))]
    async with api(routes) as (client, _):
        response = await client.get("/api/tracks/audius/au-song-D7Kydh5n")
    assert response.status_code == 429


async def test_upstream_timeout_maps_to_504() -> None:
    routes = [(r"/v1/tracks/D7Kydh5n$", httpx.ReadTimeout("slow"))]
    async with api(routes) as (client, _):
        response = await client.get("/api/tracks/audius/au-song-D7Kydh5n")
    assert response.status_code == 504
    assert response.json()["detail"] == "The provider did not respond in time."


async def test_audius_unplayable_track_is_404_not_a_silent_row() -> None:
    gated = {**AUDIUS_TRACK, "is_stream_gated": True}
    routes = [(r"/v1/tracks/D7Kydh5n$", httpx.Response(200, json={"data": gated}))]
    async with api(routes) as (client, _):
        response = await client.get("/api/tracks/audius/au-song-D7Kydh5n")
    assert response.status_code == 404
