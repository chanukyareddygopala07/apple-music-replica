/** Local library: favorites, user playlists, recently played (localStorage). */

import type { Playlist, RecentlyPlayedEntry } from '@/domain/types'
import { createStore, loadPersisted, persistStore, type Store } from '@/state/store'

export interface LibraryState {
  favoriteSongIds: string[]
  favoriteAlbumIds: string[]
  playlists: Playlist[]
  recentlyPlayed: RecentlyPlayedEntry[]
  recentlyAddedAlbumIds: string[]
}

const KEY = 'sonora:library:v1'

const DEFAULTS: LibraryState = {
  favoriteSongIds: [],
  favoriteAlbumIds: [],
  playlists: [],
  recentlyPlayed: [],
  recentlyAddedAlbumIds: [],
}

function sanitize(raw: Partial<LibraryState>): LibraryState {
  return {
    favoriteSongIds: Array.isArray(raw.favoriteSongIds) ? [...new Set(raw.favoriteSongIds)] : [],
    favoriteAlbumIds: Array.isArray(raw.favoriteAlbumIds) ? [...new Set(raw.favoriteAlbumIds)] : [],
    playlists: Array.isArray(raw.playlists)
      ? raw.playlists.filter((p) => p && typeof p.id === 'string' && typeof p.title === 'string')
      : [],
    recentlyPlayed: Array.isArray(raw.recentlyPlayed)
      ? raw.recentlyPlayed
          .filter((e) => e && typeof e.songId === 'string')
          .sort((a, b) => b.at - a.at)
          .slice(0, 40)
      : [],
    recentlyAddedAlbumIds: Array.isArray(raw.recentlyAddedAlbumIds) ? [...new Set(raw.recentlyAddedAlbumIds)] : [],
  }
}

export const libraryStore: Store<LibraryState> = createStore(sanitize({ ...DEFAULTS, ...loadPersisted(KEY, DEFAULTS) }))
persistStore(KEY, libraryStore)

export function isFavoriteSong(songId: string): boolean {
  return libraryStore.get().favoriteSongIds.includes(songId)
}

export function isFavoriteAlbum(albumId: string): boolean {
  return libraryStore.get().favoriteAlbumIds.includes(albumId)
}

export function toggleAlbumFavorite(albumId: string): boolean {
  const { favoriteAlbumIds } = libraryStore.get()
  const has = favoriteAlbumIds.includes(albumId)
  libraryStore.set((s) => ({
    ...s,
    favoriteAlbumIds: has ? favoriteAlbumIds.filter((id) => id !== albumId) : [albumId, ...favoriteAlbumIds],
  }))
  return !has
}

export function toggleFavoriteSong(songId: string): boolean {
  const { favoriteSongIds } = libraryStore.get()
  const has = favoriteSongIds.includes(songId)
  libraryStore.set((s) => ({
    ...s,
    favoriteSongIds: has ? favoriteSongIds.filter((id) => id !== songId) : [songId, ...favoriteSongIds],
  }))
  return !has
}

export function recordPlayed(songId: string, albumId?: string): void {
  libraryStore.set((s) => {
    const recent = [{ songId, at: Date.now() }, ...s.recentlyPlayed.filter((e) => e.songId !== songId)].slice(0, 40)
    const recentlyAddedAlbumIds = albumId
      ? [albumId, ...s.recentlyAddedAlbumIds.filter((id) => id !== albumId)].slice(0, 24)
      : s.recentlyAddedAlbumIds
    return { ...s, recentlyPlayed: recent, recentlyAddedAlbumIds }
  })
}

export function createPlaylist(title: string, description = ''): Playlist {
  const now = Date.now()
  const playlist: Playlist = {
    id: `user-${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    title: title.trim(),
    description: description.trim(),
    artworkSeed: `user-pl-${now}`,
    songIds: [],
    isUserPlaylist: true,
    createdAt: now,
    updatedAt: now,
  }
  libraryStore.set((s) => ({ ...s, playlists: [playlist, ...s.playlists] }))
  return playlist
}

export function updatePlaylist(id: string, patch: Partial<Pick<Playlist, 'title' | 'description'>>): void {
  libraryStore.set((s) => ({
    ...s,
    playlists: s.playlists.map((p) => (p.id === id ? { ...p, ...patch, updatedAt: Date.now() } : p)),
  }))
}

export function deletePlaylist(id: string): void {
  libraryStore.set((s) => ({ ...s, playlists: s.playlists.filter((p) => p.id !== id) }))
}

export function addSongsToPlaylist(id: string, songIds: string[]): number {
  let added = 0
  libraryStore.set((s) => ({
    ...s,
    playlists: s.playlists.map((p) => {
      if (p.id !== id) return p
      const next = [...p.songIds]
      for (const songId of songIds) {
        if (!next.includes(songId)) {
          next.push(songId)
          added++
        }
      }
      return { ...p, songIds: next, updatedAt: Date.now() }
    }),
  }))
  return added
}

export function removeSongFromPlaylist(id: string, songId: string): void {
  libraryStore.set((s) => ({
    ...s,
    playlists: s.playlists.map((p) => (p.id === id ? { ...p, songIds: p.songIds.filter((x) => x !== songId), updatedAt: Date.now() } : p)),
  }))
}

export function movePlaylistSong(id: string, from: number, to: number): void {
  libraryStore.set((s) => ({
    ...s,
    playlists: s.playlists.map((p) => {
      if (p.id !== id) return p
      const songIds = [...p.songIds]
      const [item] = songIds.splice(from, 1)
      if (item === undefined) return p
      songIds.splice(to, 0, item)
      return { ...p, songIds, updatedAt: Date.now() }
    }),
  }))
}

export function getUserPlaylist(id: string): Playlist | undefined {
  return libraryStore.get().playlists.find((p) => p.id === id)
}

/** Merge persisted user playlists over the demo provider's editorial ones. */
export function mergePlaylists(editorial: Playlist[]): Playlist[] {
  const users = libraryStore.get().playlists
  const editorialIds = new Set(editorial.map((p) => p.id))
  return [...users, ...editorial.filter((p) => !editorialIds.has(p.id))]
}
