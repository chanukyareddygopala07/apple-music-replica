/**
 * Audius → domain normalisation (pure — no I/O, fully unit-testable).
 *
 * Entity ids (prefix-routed by the catalogue facade):
 *   song     au-song-{trackId}
 *   artist   au-artist-{userId}
 *   album    au-album-t-{trackId}   single-track album synthesised per track
 *            au-album-p-{playlistId} artist album (Audius `is_album` playlist)
 *   playlist au-playlist-{playlistId}
 *
 * Unsupported by the Audius API (documented, never invented):
 * - dedicated album search (artist pages surface `users/{id}/albums`)
 * - editorial home/browse features (facade keeps the demo ones)
 * - stations / genre pages / time-synced lyrics / Apple-style ratings
 * Tracks that are deleted, unlisted, unstreamable or stream-gated are
 * dropped so every result row can actually play.
 */

import type { Album, Artist, Playlist, Song } from '@/domain/types'
import type { AudiusRawPlaylist, AudiusRawTrack, AudiusRawUser } from '@/data/audius-client'

export const AU_SONG = 'au-song-'
export const AU_ARTIST = 'au-artist-'
export const AU_ALBUM_TRACK = 'au-album-t-'
export const AU_ALBUM_PLAYLIST = 'au-album-p-'
export const AU_PLAYLIST = 'au-playlist-'

/** Extract the raw Audius id from a domain id (null when not ours). */
export function audiusRawId(domainId: string, prefix: string): string | null {
  if (!domainId.startsWith(prefix)) return null
  const raw = domainId.slice(prefix.length)
  return raw.length > 0 ? raw : null
}

type AnyRecord = Record<string, unknown>

function asRecord(value: unknown): AnyRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as AnyRecord) : null
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

const ARTWORK_PREFERENCE = [
  '1000x1000',
  '480x480',
  '150x150',
  '_1000x1000',
  '_480x480',
  '_150x150',
] as const

/** Best available remote artwork URL (http(s) only), largest size first. */
export function artworkUrl(art: unknown): string | undefined {
  const record = asRecord(art)
  if (!record) return undefined
  for (const key of ARTWORK_PREFERENCE) {
    const url = str(record[key])
    if (url && /^https?:\/\//i.test(url)) return url
  }
  return undefined
}

/** Audius marks streamable=false / gated / deleted / unlisted tracks. */
export function isPlayable(raw: AudiusRawTrack): boolean {
  if (!raw?.id) return false
  if (raw.is_delete === true) return false
  if (raw.is_unlisted === true) return false
  if (raw.is_streamable === false) return false
  if (raw.is_stream_gated === true) return false
  return true
}

export function toArtist(raw: AudiusRawUser | null | undefined): Artist | null {
  const id = str(raw?.id)
  if (!id) return null
  const picture = artworkUrl(raw?.profile_picture ?? raw?.profile_pic)
  return {
    id: `${AU_ARTIST}${id}`,
    name: str(raw?.name) ?? str(raw?.handle) ?? 'Audius Artist',
    artworkSeed: picture ?? `au-user-${id}`,
    bio: str(raw?.bio),
    genreIds: [],
  }
}

/** Map a track. `audioUrl` is left empty — the provider fills the stream URL. */
export function toSong(raw: AudiusRawTrack | null | undefined): Song | null {
  if (!raw || !isPlayable(raw)) return null
  const id = str(raw.id)
  if (!id) return null
  const artist = toArtist(raw.user)
  return {
    id: `${AU_SONG}${id}`,
    title: str(raw.title) ?? 'Untitled',
    albumId: `${AU_ALBUM_TRACK}${id}`,
    artistIds: artist ? [artist.id] : [],
    durationMs: Math.max(0, Math.round((num(raw.duration) ?? 0) * 1000)),
    trackNumber: 0,
    audioUrl: '',
    artworkUrl: artworkUrl(raw.artwork),
  }
}

/**
 * Single-track album synthesised from a track so /album and /song pages work
 * without an Audius album endpoint. Deterministic in the track id.
 */
export function albumFromTrack(raw: AudiusRawTrack | null | undefined): Album | null {
  if (!raw || !isPlayable(raw)) return null
  const id = str(raw.id)
  if (!id) return null
  const artist = toArtist(raw.user)
  return {
    id: `${AU_ALBUM_TRACK}${id}`,
    title: str(raw.title) ?? 'Untitled',
    artistId: artist?.id ?? `${AU_ARTIST}unknown`,
    artworkSeed: artworkUrl(raw.artwork) ?? `${AU_ALBUM_TRACK}${id}`,
    releaseDate: str(raw.release_date) ?? '',
    genreIds: [],
    kind: 'single',
    songIds: [`${AU_SONG}${id}`],
  }
}

/** Map an artist's album (Audius playlist with is_album=true) to an Album. */
export function albumFromPlaylist(raw: AudiusRawPlaylist | null | undefined): Album | null {
  const id = str(raw?.id)
  if (!id) return null
  const ownerId = str(raw?.user_id) ?? str(raw?.user?.id)
  return {
    id: `${AU_ALBUM_PLAYLIST}${id}`,
    title: str(raw?.playlist_name) ?? str(raw?.title) ?? 'Album',
    artistId: ownerId ? `${AU_ARTIST}${ownerId}` : `${AU_ARTIST}unknown`,
    artworkSeed: artworkUrl(raw?.artwork ?? raw?.cover_art) ?? `${AU_ALBUM_PLAYLIST}${id}`,
    releaseDate: str(raw?.release_date) ?? str(raw?.created_at) ?? '',
    genreIds: [],
    kind: 'album',
    songIds: playlistContentIds(raw),
  }
}

/** Domain song ids in playlist order (from playlist_contents; falls back to embedded tracks). */
export function playlistContentIds(raw: AudiusRawPlaylist | null | undefined): string[] {
  const contents = Array.isArray(raw?.playlist_contents) ? raw.playlist_contents : []
  const ids: string[] = []
  for (const entry of contents) {
    const id = str(asRecord(entry)?.['track_id'])
    if (id) ids.push(`${AU_SONG}${id}`)
  }
  if (ids.length === 0 && Array.isArray(raw?.tracks)) {
    for (const track of raw.tracks) {
      const id = str(track?.id)
      if (id) ids.push(`${AU_SONG}${id}`)
    }
  }
  return ids
}

export function toPlaylist(raw: AudiusRawPlaylist | null | undefined): Playlist | null {
  const id = str(raw?.id)
  if (!id) return null
  const createdAt = Date.parse(str(raw?.created_at) ?? '')
  return {
    id: `${AU_PLAYLIST}${id}`,
    title: str(raw?.playlist_name) ?? str(raw?.title) ?? 'Playlist',
    description: str(raw?.description) ?? '',
    artworkSeed: artworkUrl(raw?.artwork ?? raw?.cover_art) ?? `${AU_PLAYLIST}${id}`,
    songIds: playlistContentIds(raw),
    isUserPlaylist: false,
    curator: str(raw?.user?.name) ?? str(raw?.user?.handle),
    createdAt: Number.isFinite(createdAt) ? createdAt : undefined,
  }
}
