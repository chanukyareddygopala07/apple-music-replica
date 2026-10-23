/**
 * Bounded in-memory registry for provider-supplied (remote) entities.
 *
 * The UI's synchronous lookups (songById / artistName / albumById …) read the
 * static demo catalogue; remote providers (Audius) register the entities they
 * return here so row menus, artist labels and album links resolve for remote
 * results too. Bounded FIFO so a long browsing session cannot grow memory
 * without limit. Kept in its own module (types-only imports) to avoid
 * import cycles with the catalogue facade.
 */

import type { Album, Artist, Playlist, Song } from '@/domain/types'

const CAP = 800

const songs = new Map<string, Song>()
const artists = new Map<string, Artist>()
const albums = new Map<string, Album>()
const playlists = new Map<string, Playlist>()

function setBounded<V>(map: Map<string, V>, entries: Array<[string, V]>): void {
  for (const [id, value] of entries) {
    map.delete(id)
    map.set(id, value)
  }
  while (map.size > CAP) {
    const oldest = map.keys().next().value
    if (oldest === undefined) break
    map.delete(oldest)
  }
}

export function registerRemoteEntities(chunk: {
  songs?: Song[]
  artists?: Artist[]
  albums?: Album[]
  playlists?: Playlist[]
}): void {
  if (chunk.songs?.length) setBounded(songs, chunk.songs.map((s) => [s.id, s]))
  if (chunk.artists?.length) setBounded(artists, chunk.artists.map((a) => [a.id, a]))
  if (chunk.albums?.length) setBounded(albums, chunk.albums.map((a) => [a.id, a]))
  if (chunk.playlists?.length) setBounded(playlists, chunk.playlists.map((p) => [p.id, p]))
}

export function remoteSong(id: string): Song | undefined {
  return songs.get(id)
}

export function remoteArtist(id: string): Artist | undefined {
  return artists.get(id)
}

export function remoteAlbum(id: string): Album | undefined {
  return albums.get(id)
}

export function remotePlaylist(id: string): Playlist | undefined {
  return playlists.get(id)
}

/** Test helper: drop every registered remote entity. */
export function clearRemoteEntities(): void {
  songs.clear()
  artists.clear()
  albums.clear()
  playlists.clear()
}
