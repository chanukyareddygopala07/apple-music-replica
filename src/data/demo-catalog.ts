/**
 * Curated demo catalogue.
 * - Fictional artists / albums / songs (original project data; not Apple's catalogue).
 * - Audio: SoundHelix example tracks (https://www.soundhelix.com), free demo music.
 * - Artwork: generated per seed via src/utils/artwork.ts (no external images).
 */

import type { Album, Artist, Genre, Playlist, Song, Station } from '@/domain/types'

const audio = (n: number) => `https://www.soundhelix.com/examples/mp3/SoundHelix-Song-${n}.mp3`

export const GENRES: Genre[] = [
  { id: 'g-pop', name: 'Pop', colors: ['#ff5f9e', '#7b2ff7'] },
  { id: 'g-electronic', name: 'Electronic', colors: ['#12c2e9', '#4a00e0'] },
  { id: 'g-rock', name: 'Rock', colors: ['#f83600', '#f9d423'] },
  { id: 'g-indie', name: 'Indie', colors: ['#11998e', '#38ef7d'] },
  { id: 'g-ambient', name: 'Ambient', colors: ['#274060', '#6b8dbe'] },
  { id: 'g-jazz', name: 'Jazz', colors: ['#654ea3', '#eaafc8'] },
  { id: 'g-folk', name: 'Folk', colors: ['#c79081', '#dfa579'] },
  { id: 'g-rnb', name: 'R&B', colors: ['#c33764', '#1d2671'] },
]

export const ARTISTS: Artist[] = [
  {
    id: 'a-neon-harbor',
    name: 'Neon Harbor',
    artworkSeed: 'artist-neon-harbor',
    bio: 'A coastal synthpop duo writing songs about late ferries and city lights.',
    genreIds: ['g-pop', 'g-electronic'],
  },
  {
    id: 'a-mira-cole',
    name: 'Mira Cole',
    artworkSeed: 'artist-mira-cole',
    bio: 'Indie songwriter recording on tape machines in a converted bakery.',
    genreIds: ['g-indie', 'g-folk'],
  },
  {
    id: 'a-velvet-static',
    name: 'Velvet Static',
    artworkSeed: 'artist-velvet-static',
    bio: 'Four-piece guitar band from a rainy warehouse district.',
    genreIds: ['g-rock'],
  },
  {
    id: 'a-juniper-vale',
    name: 'Juniper Vale',
    artworkSeed: 'artist-juniper-vale',
    bio: 'Folk trio trading stories over fingerpicked guitars and close harmony.',
    genreIds: ['g-folk', 'g-indie'],
  },
  {
    id: 'a-kite-theory',
    name: 'Kite Theory',
    artworkSeed: 'artist-kite-theory',
    bio: 'Modular synth duo building patient, glowing electronic suites.',
    genreIds: ['g-electronic', 'g-ambient'],
  },
  {
    id: 'a-sol-mesa',
    name: 'Sol & The Mesa',
    artworkSeed: 'artist-sol-mesa',
    bio: 'Sunroom recordings, brass accents, and long weekend afternoons.',
    genreIds: ['g-pop', 'g-folk'],
  },
  {
    id: 'a-avery-quinn',
    name: 'Avery Quinn',
    artworkSeed: 'artist-avery-quinn',
    bio: 'Kitchen-table R&B with warm keys and close-mic vocals.',
    genreIds: ['g-rnb'],
  },
  {
    id: 'a-halcyon-park',
    name: 'Halcyon Park',
    artworkSeed: 'artist-halcyon-park',
    bio: 'Ambient instrumentals for slow windows and quieter hours.',
    genreIds: ['g-ambient'],
  },
  {
    id: 'a-ryo-trio',
    name: 'Ryo Tanaka Trio',
    artworkSeed: 'artist-ryo-trio',
    bio: 'Late-night jazz trio recorded live to two-inch tape.',
    genreIds: ['g-jazz'],
  },
  {
    id: 'a-marigold',
    name: 'The Marigold Hours',
    artworkSeed: 'artist-marigold',
    bio: 'Bright pop choruses built for open windows and long drives.',
    genreIds: ['g-pop', 'g-rock'],
  },
]

type SongSeed = {
  id: string
  title: string
  artistId: string
  durationMs: number
  audioUrl: string
  explicit?: boolean
  lyrics?: Array<{ t: number; text: string }>
}

function album(
  id: string,
  title: string,
  artistId: string,
  releaseDate: string,
  genreIds: string[],
  kind: Album['kind'],
  description: string,
  songSeeds: SongSeed[],
): { album: Album; songs: Song[] } {
  const album: Album = {
    id,
    title,
    artistId,
    artworkSeed: `album-${id}`,
    releaseDate,
    genreIds,
    kind,
    songIds: songSeeds.map((s) => s.id),
    description,
    copyright: `© ${releaseDate.slice(0, 4)} Sonora Demo Records`,
    label: 'Sonora Demo Records',
  }
  const songs: Song[] = songSeeds.map((s, i) => ({
    id: s.id,
    title: s.title,
    albumId: id,
    artistIds: [s.artistId],
    durationMs: s.durationMs,
    trackNumber: i + 1,
    audioUrl: s.audioUrl,
    explicit: s.explicit,
    lyrics: s.lyrics,
  }))
  return { album, songs }
}

const ALL: Array<{ album: Album; songs: Song[] }> = [
  album('al-tidal-lines', 'Tidal Lines', 'a-neon-harbor', '2026-08-14', ['g-pop', 'g-electronic'], 'album', 'Synthpop for the last ferry home.', [
    { id: 's-tl-1', title: 'Harbor Lights', artistId: 'a-neon-harbor', durationMs: 372_000, audioUrl: audio(1),
      lyrics: [
        { t: 0, text: 'Neon wakes the waterline' },
        { t: 14_000, text: 'Ferry horns in half past nine' },
        { t: 28_000, text: 'I keep your name in pocket change' },
        { t: 42_000, text: 'Spend it on the ride again' },
      ] },
    { id: 's-tl-2', title: 'Tidal Lines', artistId: 'a-neon-harbor', durationMs: 425_000, audioUrl: audio(2) },
    { id: 's-tl-3', title: 'Glass Pier', artistId: 'a-neon-harbor', durationMs: 344_000, audioUrl: audio(3) },
    { id: 's-tl-4', title: 'Signal Fire (feat. Mira Cole)', artistId: 'a-neon-harbor', durationMs: 390_000, audioUrl: audio(4) },
  ]),
  album('al-paper-satellites', 'Paper Satellites', 'a-mira-cole', '2026-09-02', ['g-indie'], 'ep', 'Four songs folded from letters never sent.', [
    { id: 's-ps-1', title: 'Paper Satellites', artistId: 'a-mira-cole', durationMs: 315_000, audioUrl: audio(5),
      lyrics: [
        { t: 0, text: 'Fold the corner, aim it high' },
        { t: 16_000, text: 'Paper satellites in the kitchen light' },
        { t: 33_000, text: 'If the roof lets them go' },
        { t: 48_000, text: 'Maybe morning will know' },
      ] },
    { id: 's-ps-2', title: 'Secondhand Season', artistId: 'a-mira-cole', durationMs: 288_000, audioUrl: audio(6) },
    { id: 's-ps-3', title: 'Quiet Part', artistId: 'a-mira-cole', durationMs: 352_000, audioUrl: audio(7) },
  ]),
  album('al-golden-hour-static', 'Golden Hour Static', 'a-velvet-static', '2026-07-21', ['g-rock'], 'album', 'Guitars tuned to the colour of 7pm.', [
    { id: 's-gh-1', title: 'Golden Hour Static', artistId: 'a-velvet-static', durationMs: 402_000, audioUrl: audio(8) },
    { id: 's-gh-2', title: 'Warehouse Window', artistId: 'a-velvet-static', durationMs: 361_000, audioUrl: audio(9) },
    { id: 's-gh-3', title: 'Soft Landing', artistId: 'a-velvet-static', durationMs: 327_000, audioUrl: audio(10) },
    { id: 's-gh-4', title: 'Last Call Anthem', artistId: 'a-velvet-static', durationMs: 448_000, audioUrl: audio(11), explicit: true },
    { id: 's-gh-5', title: 'Tape Hiss Hymn', artistId: 'a-velvet-static', durationMs: 305_000, audioUrl: audio(12) },
  ]),
  album('al-field-notes', 'Field Notes', 'a-juniper-vale', '2026-06-11', ['g-folk', 'g-indie'], 'album', 'Songs walked into being over a summer of long roads.', [
    { id: 's-fn-1', title: 'Field Notes', artistId: 'a-juniper-vale', durationMs: 334_000, audioUrl: audio(13) },
    { id: 's-fn-2', title: 'County Line Morning', artistId: 'a-juniper-vale', durationMs: 296_000, audioUrl: audio(14) },
    { id: 's-fn-3', title: 'Kettle Song', artistId: 'a-juniper-vale', durationMs: 258_000, audioUrl: audio(15) },
    { id: 's-fn-4', title: 'Juniper', artistId: 'a-juniper-vale', durationMs: 371_000, audioUrl: audio(16) },
  ]),
  album('al-modular-hearts', 'Modular Hearts', 'a-kite-theory', '2026-09-18', ['g-electronic', 'g-ambient'], 'album', 'Patch cables and patient pulses.', [
    { id: 's-mh-1', title: 'Patchwork Sky', artistId: 'a-kite-theory', durationMs: 415_000, audioUrl: audio(1),
      lyrics: [
        { t: 0, text: 'Voltage finds a softer route' },
        { t: 20_000, text: 'Modular hearts in a patchwork sky' },
        { t: 40_000, text: 'Hold the gate, release the light' },
        { t: 60_000, text: 'Every cable hums goodnight' },
      ] },
    { id: 's-mh-2', title: 'Control Voltage', artistId: 'a-kite-theory', durationMs: 380_000, audioUrl: audio(2) },
    { id: 's-mh-3', title: 'Envelope Fade', artistId: 'a-kite-theory', durationMs: 440_000, audioUrl: audio(3) },
    { id: 's-mh-4', title: 'Clock Divider', artistId: 'a-kite-theory', durationMs: 366_000, audioUrl: audio(4) },
  ]),
  album('al-sunroom-sessions', 'Sunroom Sessions', 'a-sol-mesa', '2026-05-30', ['g-pop', 'g-folk'], 'album', 'Recorded with the windows open.', [
    { id: 's-ss-1', title: 'Sunroom', artistId: 'a-sol-mesa', durationMs: 302_000, audioUrl: audio(5) },
    { id: 's-ss-2', title: 'Mesa Bloom', artistId: 'a-sol-mesa', durationMs: 348_000, audioUrl: audio(6) },
    { id: 's-ss-3', title: 'Slow Brunch', artistId: 'a-sol-mesa', durationMs: 275_000, audioUrl: audio(7) },
  ]),
  album('al-blue-kitchen-light', 'Blue Kitchen Light', 'a-avery-quinn', '2026-08-28', ['g-rnb'], 'album', 'Midnight keys and one perfect chorus.', [
    { id: 's-bk-1', title: 'Blue Kitchen Light', artistId: 'a-avery-quinn', durationMs: 358_000, audioUrl: audio(8),
      lyrics: [
        { t: 0, text: 'Blue kitchen light, half past two' },
        { t: 18_000, text: 'Nothing on the table but the view' },
        { t: 36_000, text: 'If staying counts as loving you' },
        { t: 54_000, text: 'Then let the morning wait outside' },
      ] },
    { id: 's-bk-2', title: 'Soft Focus', artistId: 'a-avery-quinn', durationMs: 321_000, audioUrl: audio(9) },
    { id: 's-bk-3', title: 'Left the Radio On', artistId: 'a-avery-quinn', durationMs: 290_000, audioUrl: audio(10), explicit: true },
  ]),
  album('al-slow-windows', 'Slow Windows', 'a-halcyon-park', '2026-04-16', ['g-ambient'], 'album', 'Instrumentals for quiet rooms.', [
    { id: 's-sw-1', title: 'Slow Windows', artistId: 'a-halcyon-park', durationMs: 468_000, audioUrl: audio(11) },
    { id: 's-sw-2', title: 'Afterrain', artistId: 'a-halcyon-park', durationMs: 402_000, audioUrl: audio(12) },
    { id: 's-sw-3', title: 'Linen Hour', artistId: 'a-halcyon-park', durationMs: 377_000, audioUrl: audio(13) },
  ]),
  album('al-late-train', 'Late Train', 'a-ryo-trio', '2026-07-03', ['g-jazz'], 'album', 'Three players, one platform, no overdubs.', [
    { id: 's-lt-1', title: 'Late Train', artistId: 'a-ryo-trio', durationMs: 435_000, audioUrl: audio(14) },
    { id: 's-lt-2', title: 'Platform 4', artistId: 'a-ryo-trio', durationMs: 388_000, audioUrl: audio(15) },
    { id: 's-lt-3', title: 'Two-Minute Warning', artistId: 'a-ryo-trio', durationMs: 352_000, audioUrl: audio(16) },
  ]),
  album('al-marigold', 'Marigold', 'a-marigold', '2026-09-25', ['g-pop', 'g-rock'], 'single', 'A bright single for open windows.', [
    { id: 's-mg-1', title: 'Marigold', artistId: 'a-marigold', durationMs: 312_000, audioUrl: audio(1),
      lyrics: [
        { t: 0, text: 'Marigold on the fire escape' },
        { t: 15_000, text: 'Turning to the sun again' },
        { t: 30_000, text: 'You said summer ends, I said wait' },
        { t: 45_000, text: 'There is gold in the ordinary day' },
      ] },
    { id: 's-mg-2', title: 'Marigold (Acoustic)', artistId: 'a-marigold', durationMs: 289_000, audioUrl: audio(2) },
  ]),
]

export const ALBUMS: Album[] = ALL.map((x) => x.album)
export const SONGS: Song[] = ALL.flatMap((x) => x.songs)

const songIds = (...ids: string[]) => ids

export const PLAYLISTS: Playlist[] = [
  {
    id: 'pl-deep-focus',
    title: 'Deep Focus',
    description: 'Long-form instrumentals that keep the room quiet and the work moving.',
    artworkSeed: 'pl-deep-focus',
    songIds: songIds('s-sw-1', 's-sw-2', 's-mh-3', 's-sw-3', 's-lt-2', 's-mh-4', 's-fn-3'),
    isUserPlaylist: false,
    curator: 'Sonora Editors',
  },
  {
    id: 'pl-morning-coffee',
    title: 'Morning Coffee',
    description: 'Gentle folk and warm keys for the first hour of the day.',
    artworkSeed: 'pl-morning-coffee',
    songIds: songIds('s-fn-2', 's-ss-3', 's-fn-3', 's-ps-1', 's-ss-1', 's-fn-1'),
    isUserPlaylist: false,
    curator: 'Sonora Editors',
  },
  {
    id: 'pl-weekend-drive',
    title: 'Weekend Drive',
    description: 'Windows-down pop and guitar anthems for the long way round.',
    artworkSeed: 'pl-weekend-drive',
    songIds: songIds('s-mg-1', 's-gh-1', 's-tl-1', 's-ss-2', 's-gh-4', 's-tl-4', 's-mg-2'),
    isUserPlaylist: false,
    curator: 'Sonora Editors',
  },
  {
    id: 'pl-late-night-code',
    title: 'Late Night Code',
    description: 'Steady electronic pulses for deep work after dark.',
    artworkSeed: 'pl-late-night-code',
    songIds: songIds('s-mh-1', 's-mh-2', 's-tl-2', 's-sw-1', 's-mh-4', 's-tl-3'),
    isUserPlaylist: false,
    curator: 'Sonora Editors',
  },
  {
    id: 'pl-first-light',
    title: 'First Light',
    description: 'Ambient washes that meet you before the alarm does.',
    artworkSeed: 'pl-first-light',
    songIds: songIds('s-sw-2', 's-sw-3', 's-mh-3', 's-sw-1'),
    isUserPlaylist: false,
    curator: 'Sonora Editors',
  },
  {
    id: 'pl-kitchen-soul',
    title: 'Kitchen Soul',
    description: 'Close-mic R&B for cooking for two.',
    artworkSeed: 'pl-kitchen-soul',
    songIds: songIds('s-bk-1', 's-bk-2', 's-bk-3', 's-lt-1'),
    isUserPlaylist: false,
    curator: 'Sonora Editors',
  },
]

export const STATIONS: Station[] = [
  {
    id: 'st-night-drive',
    name: 'Night Drive Radio',
    description: 'Synth glow and open roads — endless rotation.',
    artworkSeed: 'st-night-drive',
    songIds: songIds('s-tl-1', 's-mh-1', 's-tl-2', 's-mh-2', 's-gh-1', 's-tl-3', 's-mh-3'),
    genreId: 'g-electronic',
  },
  {
    id: 'st-sunday-slow',
    name: 'Sunday Slow',
    description: 'Folk and indie for a kitchen full of light.',
    artworkSeed: 'st-sunday-slow',
    songIds: songIds('s-fn-1', 's-ss-1', 's-ps-1', 's-fn-2', 's-ss-3', 's-ps-3'),
    genreId: 'g-folk',
  },
  {
    id: 'st-focus-flow',
    name: 'Focus Flow',
    description: 'Ambient suites with nowhere to be.',
    artworkSeed: 'st-focus-flow',
    songIds: songIds('s-sw-1', 's-sw-2', 's-mh-3', 's-sw-3'),
    genreId: 'g-ambient',
  },
  {
    id: 'st-city-jazz',
    name: 'City Jazz',
    description: 'Late trains and live-room warmth.',
    artworkSeed: 'st-city-jazz',
    songIds: songIds('s-lt-1', 's-lt-2', 's-lt-3', 's-bk-1'),
    genreId: 'g-jazz',
  },
  {
    id: 'st-golden-classics',
    name: 'Golden Classics',
    description: 'Bright choruses from the Sonora demo shelf.',
    artworkSeed: 'st-golden-classics',
    songIds: songIds('s-mg-1', 's-gh-1', 's-tl-1', 's-ss-2', 's-gh-5', 's-mg-2', 's-bk-2'),
    genreId: 'g-pop',
  },
]
