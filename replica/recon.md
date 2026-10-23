# Recon map: Apple Music (web player) → "Sonora" clone

Scope: the logged-out public web player at music.apple.com plus the standard
signed-in player behaviours that the product documents (library, playlists,
queue, favorites). Platform: desktop + mobile web.
For: a demo web app with an original identity ("Sonora"), framework-free.
Date: 2026-10-23

## Sources

| # | source | URL | notes |
| --- | --- | --- | --- |
| 1 | live web player | https://music.apple.com/in/ | captured desktop 1440×900 + mobile 390×844 (see screens/) |
| 2 | album page | clicked through from home | full-bleed theme colour from artwork |
| 3 | artist page | clicked through from album | full-bleed hero, Top Songs grid |
| 4 | search page + autocomplete | /search | floating search pill, category cards |
| 5 | library page | /library/recently-added | gated behind sign-in (wall captured) |
| 6 | MusicKit overview | https://developer.apple.com/musickit/ | developer token (.p8-signed), user auth, subscription needed to stream |
| 7 | MusicKit on the Web | https://developer.apple.com/musickit/web/ | beta; MusicKit JS v3 CDN |

## Core loop

Discover something to play (home/browse/search/library) → play it → control it
from a persistent player (queue, favorites, playlists) → come back later and
find history + library intact.

## Screens

| ID | screen | route / how to reach | purpose | key components | states seen |
| --- | --- | --- | --- | --- | --- |
| S01 | Home ("New" when signed out) | / | featured editorial, song grids, album carousels | sidebar, editorial cards, song rows, album carousel | loading, filled; promo wall when signed out |
| S02 | Browse | sidebar Browse | categories, charts, new releases | category cards (photo + colour wash), chart lists | empty n/a, filled |
| S03 | Radio | sidebar Radio | stations, on-air content | station cards, live badges | filled |
| S04 | Search | sidebar Search | discover by query | floating search pill, autocomplete dropdown, category grid | idle (categories), suggestions |
| S05 | Search results | type in search | grouped results | top result, songs, albums, artists, playlists | no-results, filled |
| S06 | Album | click album | track list, album actions | themed hero (art-derived gradient), cover, play pill, track rows | loading, filled, unavailable (pre-release) |
| S07 | Artist | click artist | identity + top content | full-bleed hero, play/favorite circles, top songs, albums | filled |
| S08 | Player playing | any + play | transport + progress | floating pill (signed out) / full bar (signed in) | idle, playing, paused |
| S09 | Library | sidebar Library (signed in) | saved content | tabs Playlists/Artists/Albums/Songs, recently added grid | auth wall (signed out), empty, filled |
| S10 | Playlist | click playlist | ordered tracks | hero, play/shuffle, track rows, edit | loading, filled, user-playlist edit |
| S11 | Now Playing | expand player | focused playback | large artwork, controls, lyrics panel, up-next | loading, filled, lyrics-unavailable |
| S12 | Queue panel | player queue button | upcoming list | up-next rows, reorder, remove, clear | empty, filled |
| S13 | Song page | click song | track detail | artwork, metadata, play, related | filled |
| S14 | Mobile shell | 390px viewport | compact nav | hamburger drawer, bottom tabs, compact player | folded/unfolded menu |

## Flows

```
F01 Discover and play from home
    S01 -> click card -> S06 -> play -> S08 (+ S11)
    happy path clicks: 3
    edge: audio blocked by autoplay policy, track unavailable
F02 Search and play a song
    S04 -> type -> S05 -> play row -> S08
    happy path clicks: 3
    edge: no results, partial name
F03 Manage the queue
    S08/S11 -> S12 -> reorder/remove/clear -> playback continues
    edge: empty queue, queue of one
F04 Build a playlist
    S09 -> create -> add tracks from S06/S13 -> S10 -> play
    edge: empty playlist, duplicate add, delete playlist
F05 Favorite tracks and find them later
    S06 heart -> S09 Songs tab -> play
    edge: unfavorite, empty library
```

## Components

| component | variants | states | used on |
| --- | --- | --- | --- |
| Sidebar nav | item, section-label | default, hover, selected | all desktop |
| Bottom tabs | 5 tabs | default, active | mobile |
| Editorial card | feature (landscape), album (square) | default, hover (play overlay) | S01 |
| Song row | compact (grid cell), full (list) | default, hover, playing, explicit | S01,S05,S06,S10,S11 |
| Play button | large circle, pill | play, pause, disabled | S06,S07,S08,S11 |
| Player bar | desktop full, mobile compact | idle, playing, loading, error | all |
| Progress slider | bar, thin edge line | hover, drag, buffered | S08,S11 |
| Volume | horizontal, mute | default, muted | S08 |
| Queue panel | side sheet / section | empty, filled, dragging | S12 |
| Lyrics panel | synced lines | loading, unavailable, filled | S11 |
| Dialog | create playlist, confirm | open, validation error | S09,S10 |
| Toast | info, error | auto-dismiss | all |
| Skeleton | card, row, hero | shimmer | loading states |
| Search pill | idle, focused, filled | suggestions dropdown | S04,S05 |

## Inferred data model

```
Artist   id, name, artwork, bio?, genreIds[]           evidence: S07 confidence high
Album    id, title, artistId, artwork, releaseDate, genreIds[], kind(album|ep|single)
         confidence high
Song     id, title, albumId, artistIds[], durationMs, trackNumber, audioUrl,
         explicit?, lyrics?{lines[{t,txt}]}            evidence: S06 track rows
Playlist id, title, description, artwork?, songIds[], ownedByUser
Station  id, name, description, artwork, seedSongIds[] evidence: S03 (rebuilt as demo stations)
QueueItem queueItemId, songId                         evidence: S12
PlaybackState status, songId, position, duration, volume, muted, shuffle, repeat
LibraryEntry favorites: songId[], albumId[]; recentlyPlayed: {songId, at}[]
```

## Feature matrix

See `features.csv`. Must 22, should 11, could 6, skip 9.

## Out of scope (cannot or should not be cloned)

- Apple's licensed catalogue, artwork, editorial copy, branding/logo (skip).
- Subscription billing, sign-in with Apple ID (skip; library is local-only).
- Full-length Apple Music streaming without a real MusicKit developer token
  (skip until configured; demo audio used instead).
- Live radio stations broadcast by Apple (replaced by demo genre stations).
- Handoff / AirPlay / spatial audio / lyrics licences.

## Size

Screens 14, flows 5+, entities 8. Hard parts: playback engine (queue,
shuffle/repeat, persistence), visual parity of themed heroes, mobile shell.
Size: L.
