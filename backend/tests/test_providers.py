"""Normalisation mirrors the frontend's TypeScript adapters, rule for rule."""

from __future__ import annotations

import httpx
import pytest

from app.cache import TTLCache
from app.config import AudiusSettings, JamendoSettings, YoutubeSettings
from app.providers import audius as au
from app.providers import jamendo as jm
from app.providers import youtube as yt

AU_SETTINGS = AudiusSettings(
    enabled=True, api_key="SERVER-KEY-NEVER-ECHOED", base_url="https://api.audius.co/v1"
)
JM_SETTINGS = JamendoSettings(
    enabled=True, client_id="client-secret-id", base_url="https://api.jamendo.com/v3.0"
)


def audius_track(**overrides):
    raw = {
        "id": "D7Kydh5n",
        "title": "Sunset Drive",
        "duration": 213.4,
        "is_streamable": True,
        "is_delete": False,
        "is_unlisted": False,
        "is_stream_gated": False,
        "artwork": {
            "1000x1000": "https://creator.audius.co/x-1000.jpg",
            "150x150": "https://creator.audius.co/x-150.jpg",
        },
        "user": {"id": "user-1", "name": "Nova Lane", "handle": "novalane"},
    }
    raw.update(overrides)
    return raw


# --- Audius -----------------------------------------------------------------


def test_audius_track_normalises_to_the_domain_shape() -> None:
    track = au.to_track(AU_SETTINGS, audius_track())
    assert track is not None
    assert track.id == "au-song-D7Kydh5n"
    assert track.artist_ids == ["au-artist-user-1"]
    assert track.duration_ms == 213400
    assert track.source == "audius"
    assert track.playback_kind == "audio"
    assert track.artwork_url == "https://creator.audius.co/x-1000.jpg"  # largest first


def test_audius_stream_url_never_carries_the_api_key() -> None:
    track = au.to_track(AU_SETTINGS, audius_track())
    assert track is not None
    assert track.audio_url == "https://api.audius.co/v1/tracks/D7Kydh5n/stream"
    assert "SERVER-KEY" not in track.audio_url
    assert "api_key" not in track.audio_url


@pytest.mark.parametrize(
    "overrides",
    [
        {"is_delete": True},
        {"is_unlisted": True},
        {"is_streamable": False},
        {"is_stream_gated": True},
        {"id": ""},
    ],
)
def test_unplayable_audius_tracks_are_dropped(overrides: dict) -> None:
    assert au.to_track(AU_SETTINGS, audius_track(**overrides)) is None


def test_audius_single_track_album_synthesises_song_ids() -> None:
    album = au.album_from_track(AU_SETTINGS, audius_track())
    assert album is not None
    assert album.kind == "single"
    assert album.song_ids == ["au-song-D7Kydh5n"]


def test_audius_playlist_content_ids_prefer_playlist_contents() -> None:
    raw = {
        "id": "p1",
        "playlist_name": "Mix",
        "playlist_contents": [{"track_id": "a1"}, {"track_id": "a2"}],
    }
    playlist = au.to_playlist(raw)
    assert playlist is not None
    assert playlist.song_ids == ["au-song-a1", "au-song-a2"]
    assert playlist.is_user_playlist is False


# --- Jamendo ----------------------------------------------------------------


def jamendo_track(**overrides):
    raw = {
        "id": "1848357",
        "name": "Coastal Light",
        "duration": 180.5,
        "position": 3,
        "audio": "https://prod-1.storage.jamendo.com/?trackid=1848357&format=mp32",
        "image": "https://usercontent.jamendo.com/a.jpg",
        "album_id": "555",
        "album_name": "Open Skies",
        "album_image": "https://usercontent.jamendo.com/b.jpg",
        "artist_id": "77",
        "artist_name": "Mira Cole",
        "shareurl": "https://www.jamendo.com/track/1848357",
        "license_ccurl": "https://creativecommons.org/licenses/by-nc-nd/4.0/",
        "musicinfo": {"lang": "fr"},
        "releasedate": "2023-04-01",
    }
    raw.update(overrides)
    return raw


def test_jamendo_track_normalises_with_licence_and_lyrics_language() -> None:
    track = jm.to_track(jamendo_track())
    assert track is not None
    assert track.id == "jm-song-1848357"
    assert track.album_id == "jm-album-555"
    assert track.duration_ms == 180500
    assert track.track_number == 3
    assert track.source == "jamendo"
    assert track.language == "fr"
    assert track.language_status == "verified"
    assert track.attribution == "Jamendo"
    assert track.attribution_url == "https://creativecommons.org/licenses/by-nc-nd/4.0/"
    assert track.audio_url.startswith("https://prod-1.storage.jamendo.com/")


def test_jamendo_track_without_a_stream_or_title_is_dropped() -> None:
    assert jm.to_track(jamendo_track(audio="")) is None
    assert jm.to_track(jamendo_track(audio="ftp://x")) is None
    assert jm.to_track(jamendo_track(name="  ")) is None


def test_jamendo_single_track_album_id_when_no_album() -> None:
    track = jm.to_track(jamendo_track(album_id=None))
    assert track is not None
    assert track.album_id == "jm-album-t-1848357"


def test_jamendo_raw_track_id_rejects_junk() -> None:
    assert jm.raw_track_id("jm-song-1848357") == "1848357"
    assert jm.raw_track_id("1848357") == "1848357"
    assert jm.raw_track_id("jm-song-../../etc") is None
    assert jm.raw_track_id("") is None


# --- YouTube ----------------------------------------------------------------


def test_iso8601_duration_parsing() -> None:
    assert yt.parse_iso8601_duration("PT3M33S") == 213000
    assert yt.parse_iso8601_duration("PT1H2M3S") == 3723000
    assert yt.parse_iso8601_duration("P1DT2H") == 93600000
    assert yt.parse_iso8601_duration("nonsense") == 0
    assert yt.parse_iso8601_duration(None) == 0


def test_youtube_track_is_video_only_with_official_watch_url() -> None:
    snippet = {
        "title": "Ocean&#39;s Echo (Official Video)",
        "channelId": "UC123",
        "channelTitle": "Blue Room",
        "thumbnails": {"high": {"url": "https://i.ytimg.com/vi/dQw4w9WgXcQ/hq.jpg"}},
    }
    track = yt.to_track(snippet, video_id="dQw4w9WgXcQ", duration_ms=213000)
    assert track is not None
    assert track.id == "yt-dQw4w9WgXcQ"
    assert track.title == "Ocean's Echo (Official Video)"  # entities decoded once
    assert track.audio_url == ""  # never routed through the <audio> engine
    assert track.playback_kind == "youtube"
    assert track.external_url == "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    assert track.source == "youtube"


def test_youtube_ids_are_scoped_correctly() -> None:
    assert yt.youtube_video_id("yt-dQw4w9WgXcQ") == "dQw4w9WgXcQ"
    assert yt.youtube_video_id("yt-artist-UC123") is None  # never a song
    assert yt.youtube_video_id("yt-album-x") is None
    assert yt.is_video_id("dQw4w9WgXcQ")
    assert not yt.is_video_id("short")
    assert not yt.is_video_id(None)


def test_channel_ids_never_leak_into_video_ids() -> None:
    # A channel id starting with UC + 22 chars is not 11 chars, but an
    # 11-char string must still only be accepted as a video id shape.
    assert not yt.is_video_id("UCabcdefghijklmnopqrstuv")


# --- provider wiring ---------------------------------------------------------


def provider(cls, settings, routes):  # noqa: ANN001
    calls: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        for pattern, value in routes:
            if pattern in str(request.url):
                return value
        return httpx.Response(404, json={})

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    instance = cls(settings, client, timeout_s=2.0, gap_ms=0, cache=TTLCache())
    return instance, calls


async def test_audius_search_drops_unplayable_rows_and_keeps_artists() -> None:
    body = {
        "data": [
            audius_track(),
            audius_track(id="gone", is_delete=True),
        ]
    }
    users = {"data": [{"id": "user-1", "name": "Nova Lane", "handle": "novalane"}]}
    p, calls = provider(
        au.AudiusProvider,
        AU_SETTINGS,
        [
            ("/tracks/search", httpx.Response(200, json=body)),
            ("/users/search", httpx.Response(200, json=users)),
        ],
    )
    page = await p.search("sunset", limit=5)
    assert [t.id for t in page.tracks] == ["au-song-D7Kydh5n"]
    assert [a.name for a in page.artists] == ["Nova Lane"]
    # No language parameter exists for Audius — nothing is faked.
    assert all("lang" not in str(c.url) for c in calls)
    await p._fetcher._client.aclose()


async def test_jamendo_search_applies_only_documented_params() -> None:
    body = {"headers": {"status": "success"}, "results": [jamendo_track()]}
    p, calls = provider(
        jm.JamendoProvider,
        JM_SETTINGS,
        [("/tracks", httpx.Response(200, json=body))],
    )
    page = await p.search("coastal", language="fr", limit=10)
    assert page.tracks[0].language == "fr"
    request = next(c for c in calls if "/tracks" in str(c.url))
    assert request.url.params["lang"] == "fr"
    assert request.url.params["client_id"] == "client-secret-id"
    # Never invented: playlist search surface.
    assert page.playlists == []
    await p._fetcher._client.aclose()


async def test_jamendo_envelope_errors_are_surfaced_with_their_message() -> None:
    body = {"headers": {"status": "error", "error_message": "Invalid client_id"}, "results": []}
    p, _ = provider(jm.JamendoProvider, JM_SETTINGS, [("/tracks", httpx.Response(200, json=body))])
    with pytest.raises(Exception) as excinfo:
        await p.search("x")
    assert "Invalid client_id" in str(excinfo.value)
    await p._fetcher._client.aclose()


async def test_jamendo_never_invents_playlists_on_empty_results() -> None:
    body = {"headers": {"status": "success"}, "results": []}
    p, _ = provider(jm.JamendoProvider, JM_SETTINGS, [("/tracks", httpx.Response(200, json=body))])
    page = await p.search("nothing here")
    assert page.tracks == []
    assert page.playlists == []
    assert page.cursor is None  # short page → no next cursor
    await p._fetcher._client.aclose()


async def test_unconfigured_provider_refuses_to_call_the_network() -> None:
    unconfigured = JamendoSettings(
        enabled=True, client_id=None, base_url="https://api.jamendo.com/v3.0"
    )
    p, calls = provider(jm.JamendoProvider, unconfigured, [])
    with pytest.raises(Exception) as excinfo:
        await p.search("x")
    assert "JAMENDO_CLIENT_ID" in str(excinfo.value)
    assert calls == []  # the network was never touched
    await p._fetcher._client.aclose()


async def test_youtube_search_sets_relevance_hint_and_embeddable_filter() -> None:
    search_body = {
        "items": [
            {
                "id": {"videoId": "dQw4w9WgXcQ"},
                "snippet": {"title": "Clip", "channelId": "UC1", "channelTitle": "Ch"},
            },
            {"id": {"videoId": "invalid!"}, "snippet": {"title": "Bad", "channelId": "UC1"}},
        ],
        "nextPageToken": "CAoQAA",
    }
    videos_body = {
        "items": [
            {
                "id": "dQw4w9WgXcQ",
                "contentDetails": {"duration": "PT3M33S"},
                "status": {"madeForKids": False},
            }
        ]
    }
    yt_settings = YoutubeSettings(
        enabled=True,
        api_key="AIzaTESTKEY-not-real",
        base_url="https://www.googleapis.com/youtube/v3",
    )
    p, calls = provider(
        yt.YoutubeProvider,
        yt_settings,
        [
            ("/search", httpx.Response(200, json=search_body)),
            ("/videos", httpx.Response(200, json=videos_body)),
        ],
    )
    page = await p.search("official video", language="en", limit=5)
    assert [t.id for t in page.tracks] == ["yt-dQw4w9WgXcQ"]  # malformed id dropped
    assert page.tracks[0].duration_ms == 213000
    assert page.cursor == "CAoQAA"
    search_request = next(c for c in calls if "/search" in str(c.url))
    assert search_request.url.params["relevanceLanguage"] == "en"
    assert search_request.url.params["videoEmbeddable"] == "true"
    assert search_request.url.params["key"] == "AIzaTESTKEY-not-real"
    await p._fetcher._client.aclose()


async def test_youtube_search_survives_a_failed_duration_lookup() -> None:
    search_body = {
        "items": [
            {"id": {"videoId": "dQw4w9WgXcQ"}, "snippet": {"title": "Clip", "channelId": "UC1"}}
        ]
    }
    yt_settings = YoutubeSettings(
        enabled=True, api_key="k", base_url="https://www.googleapis.com/youtube/v3"
    )
    p, _ = provider(
        yt.YoutubeProvider,
        yt_settings,
        [
            ("/search", httpx.Response(200, json=search_body)),
            ("/videos", httpx.Response(500, json={})),
        ],
    )
    page = await p.search("clip")
    assert len(page.tracks) == 1
    assert page.tracks[0].duration_ms == 0  # no duration, but the row survives
    await p._fetcher._client.aclose()


async def test_youtube_get_track_reports_made_for_kids() -> None:
    videos_body = {
        "items": [
            {
                "id": "dQw4w9WgXcQ",
                "snippet": {
                    "title": "Kids Clip",
                    "channelId": "UC1",
                    "channelTitle": "Ch",
                    "publishedAt": "2024-01-01T00:00:00Z",
                },
                "contentDetails": {"duration": "PT1M"},
                "status": {"madeForKids": True},
            }
        ]
    }
    yt_settings = YoutubeSettings(
        enabled=True, api_key="k", base_url="https://www.googleapis.com/youtube/v3"
    )
    p, _ = provider(
        yt.YoutubeProvider, yt_settings, [("/videos", httpx.Response(200, json=videos_body))]
    )
    detail = await p.get_track("yt-dQw4w9WgXcQ")
    assert detail is not None
    assert detail.made_for_kids is True
    assert detail.track.playback_kind == "youtube"
    assert detail.albums[0].song_ids == ["yt-dQw4w9WgXcQ"]
    await p._fetcher._client.aclose()


async def test_youtube_get_track_rejects_channel_and_album_ids() -> None:
    yt_settings = YoutubeSettings(
        enabled=True, api_key="k", base_url="https://www.googleapis.com/youtube/v3"
    )
    p, calls = provider(yt.YoutubeProvider, yt_settings, [])
    assert await p.get_track("yt-artist-UC123") is None
    assert await p.get_track("yt-album-x") is None
    assert calls == []
    await p._fetcher._client.aclose()
