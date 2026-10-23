/** Sync lookups the UI needs (artist names, catalogue handle). */

import { catalog } from '@/data/catalog'
import { ALBUMS, ARTISTS, PLAYLISTS, SONGS } from '@/data/demo-catalog'
import type { Album, Artist, Playlist, Song } from '@/domain/types'

export function getCatalog(): typeof catalog {
  return catalog
}

const artistMap = new Map(ARTISTS.map((a) => [a.id, a]))
const albumMap = new Map(ALBUMS.map((a) => [a.id, a]))
const songMap = new Map(SONGS.map((s) => [s.id, s]))
const playlistMap = new Map(PLAYLISTS.map((p) => [p.id, p]))

export function artistById(id: string): Artist | undefined {
  return artistMap.get(id)
}

export function albumById(id: string): Album | undefined {
  return albumMap.get(id)
}

export function songById(id: string): Song | undefined {
  return songMap.get(id)
}

export function editorialPlaylistById(id: string): Playlist | undefined {
  return playlistMap.get(id)
}

export function artistName(id: string | undefined): string {
  return (id && artistMap.get(id)?.name) || 'Unknown Artist'
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
