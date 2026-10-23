/** Sync lookups the UI needs (artist names, catalogue handle). */

import { catalog } from '@/data/catalog'
import { ALBUMS, ARTISTS, PLAYLISTS, SONGS } from '@/data/demo-catalog'
import { remoteAlbum, remoteArtist, remotePlaylist, remoteSong } from '@/data/remote-registry'
import type { Album, Artist, Playlist, Song } from '@/domain/types'

export function getCatalog(): typeof catalog {
  return catalog
}

const artistMap = new Map(ARTISTS.map((a) => [a.id, a]))
const albumMap = new Map(ALBUMS.map((a) => [a.id, a]))
const songMap = new Map(SONGS.map((s) => [s.id, s]))
const playlistMap = new Map(PLAYLISTS.map((p) => [p.id, p]))

export function artistById(id: string): Artist | undefined {
  return artistMap.get(id) ?? remoteArtist(id)
}

export function albumById(id: string): Album | undefined {
  return albumMap.get(id) ?? remoteAlbum(id)
}

export function songById(id: string): Song | undefined {
  return songMap.get(id) ?? remoteSong(id)
}

export function editorialPlaylistById(id: string): Playlist | undefined {
  return playlistMap.get(id) ?? remotePlaylist(id)
}

export function artistName(id: string | undefined): string {
  if (!id) return 'Unknown Artist'
  return artistMap.get(id)?.name ?? remoteArtist(id)?.name ?? 'Unknown Artist'
}

export function artistNamesFor(song: Song): string {
  return song.artistIds.map((id) => artistName(id)).join(', ') || 'Unknown Artist'
}

export function albumArtist(album: Album): string {
  return artistName(album.artistId)
}

export function allDemoSongs(): Song[] {
  return SONGS
}

export function registerDemoIndexIntoEngine(): void {
  /* kept for future cross-module needs */
}
