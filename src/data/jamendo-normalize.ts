/**
 * Jamendo → domain normalisation (pure — no I/O, fully unit-testable).
 *
 * Entity ids (prefix-routed by the catalogue facade):
 *   song     jm-song-{trackId}
 *   artist   jm-artist-{artistId}
 *   album    jm-album-{albumId}       real album (album_id present)
 *            jm-album-t-{trackId}     single synthesised per track (no album)
 * Playlists are not part of the Jamendo read surface used here (documented
 * in the provider) — nothing is invented for them.
 *
 * Only documented fields are read (developer.jamendo.com/v3.0/tracks):
 * id, name, duration (seconds), artist_id/artist_name, album_id/album_name,
 * album_image/image, audio (stream), audiodownload, license_ccurl,
 * releasedate, shareurl, and — with `include=musicinfo` — musicinfo.lang
 * (the track's stated lyrics language). A track without an `audio` stream URL
 * is dropped so every result row can actually play.
 */

import type { Album, Artist, Song } from '@/domain/types'
import type { JamendoRawAlbum, JamendoRawArtist, JamendoRawTrack } from '@/data/jamendo-client'

export const JM_SONG = 'jm-song-'
export const JM_ARTIST = 'jm-artist-'
export const JM_ALBUM = 'jm-album-'
export const JM_ALBUM_SINGLE = 'jm-album-t-'

/** Extract the raw Jamendo id from a domain id (null when not ours). */
export function jamendoRawId(domainId: string, prefix: string): string | null {
  if (!domainId.startsWith(prefix)) return null
  const raw = domainId.slice(prefix.length)
  return raw.length > 0 ? raw : null
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function num(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const n = Number(value)
    if (Number.isFinite(n)) return n
  }
  return undefined
}

/** http(s) only — Jamendo's usercontent/storage hosts always qualify. */
function httpUrl(value: unknown): string | undefined {
  const v = str(value)
  return v && /^https?:\/\//i.test(v) ? v : undefined
}

/** Stated lyrics language (ISO 639-1) — present only when the track says so. */
function lyricLanguage(raw: JamendoRawTrack): string | undefined {
  const value = typeof raw.musicinfo?.lang === 'string' ? raw.musicinfo.lang.trim() : ''
  return /^[a-z]{2}$/i.test(value) ? value.toLowerCase() : undefined
}

export function toJamendoArtist(raw: JamendoRawTrack | null | undefined): Artist | null {
  const id = str(raw?.artist_id)
  if (!id) return null
  return {
    id: `${JM_ARTIST}${id}`,
    name: str(raw?.artist_name) ?? 'Jamendo Artist',
    artworkSeed: httpUrl(raw?.image ?? raw?.album_image) ?? `jm-artist-${id}`,
    genreIds: [],
  }
}

export function toJamendoArtistFromRaw(raw: JamendoRawArtist | null | undefined): Artist | null {
  const id = str(raw?.id)
  if (!id) return null
  return {
    id: `${JM_ARTIST}${id}`,
    name: str(raw?.name) ?? 'Jamendo Artist',
    artworkSeed: httpUrl(raw?.image) ?? `jm-artist-${id}`,
    genreIds: [],
  }
}

/** Map a track. `audioUrl` comes straight from the documented `audio` field. */
export function toJamendoSong(raw: JamendoRawTrack | null | undefined): Song | null {
  if (!raw) return null
  const id = str(raw.id)
  const audio = httpUrl(raw.audio)
  if (!id || !audio) return null
  const name = str(raw.name)
  if (!name) return null
  const artist = toJamendoArtist(raw)
  const albumId = str(raw.album_id)
  const artwork = httpUrl(raw.image ?? raw.album_image)
  const language = lyricLanguage(raw)
  return {
    id: `${JM_SONG}${id}`,
    title: name,
    albumId: albumId ? `${JM_ALBUM}${albumId}` : `${JM_ALBUM_SINGLE}${id}`,
    artistIds: artist ? [artist.id] : [],
    durationMs: Math.max(0, Math.round((num(raw.duration) ?? 0) * 1000)),
    trackNumber: num(raw.position) ?? 0,
    audioUrl: audio,
    source: 'jamendo',
    playbackKind: 'audio',
    artworkUrl: artwork,
    externalUrl: httpUrl(raw.shareurl),
    attribution: 'Jamendo',
    attributionUrl: httpUrl(raw.license_ccurl),
    language,
    languageStatus: language ? 'verified' : undefined,
  }
}

/** Album surfaced from an album-track row (the album view fetches details). */
export function albumFromTrack(raw: JamendoRawTrack | null | undefined): Album | null {
  const albumId = str(raw?.album_id)
  if (!raw || !albumId) return null
  const artist = toJamendoArtist(raw)
  return {
    id: `${JM_ALBUM}${albumId}`,
    title: str(raw?.album_name) ?? 'Album',
    artistId: artist?.id ?? `${JM_ARTIST}unknown`,
    artworkSeed: httpUrl(raw?.album_image ?? raw?.image) ?? `${JM_ALBUM}${albumId}`,
    releaseDate: str(raw?.releasedate) ?? '',
    genreIds: [],
    kind: 'album',
    songIds: [],
  }
}

/** Single-track album synthesised from a track with no album (Jamendo singles). */
export function singleAlbumFromTrack(raw: JamendoRawTrack | null | undefined): Album | null {
  const id = str(raw?.id)
  if (!id) return null
  const name = str(raw?.name)
  if (!name) return null
  const artist = toJamendoArtist(raw)
  return {
    id: `${JM_ALBUM_SINGLE}${id}`,
    title: name,
    artistId: artist?.id ?? `${JM_ARTIST}unknown`,
    artworkSeed: httpUrl(raw?.image ?? raw?.album_image) ?? `${JM_ALBUM_SINGLE}${id}`,
    releaseDate: str(raw?.releasedate) ?? '',
    genreIds: [],
    kind: 'single',
    songIds: [`${JM_SONG}${id}`],
  }
}

export function toJamendoAlbum(raw: JamendoRawAlbum | null | undefined): Album | null {
  const id = str(raw?.id)
  if (!id) return null
  const name = str(raw?.name)
  if (!name) return null
  const artistId = str(raw?.artist_id)
  return {
    id: `${JM_ALBUM}${id}`,
    title: name,
    artistId: artistId ? `${JM_ARTIST}${artistId}` : `${JM_ARTIST}unknown`,
    artworkSeed: httpUrl(raw?.image) ?? `${JM_ALBUM}${id}`,
    releaseDate: str(raw?.releasedate) ?? '',
    genreIds: [],
    kind: 'album',
    songIds: [],
  }
}
