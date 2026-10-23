import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  libraryStore,
  toggleFavoriteSong,
  isFavoriteSong,
  toggleAlbumFavorite,
  isFavoriteAlbum,
  createPlaylist,
  updatePlaylist,
  deletePlaylist,
  addSongsToPlaylist,
  removeSongFromPlaylist,
  movePlaylistSong,
  getUserPlaylist,
  recordPlayed,
} from '@/state/library-store'

function emptyLibrary() {
  return {
    favoriteSongIds: [],
    favoriteAlbumIds: [],
    playlists: [],
    recentlyPlayed: [],
    recentlyAddedAlbumIds: [],
  }
}

/** jsdom in this vitest setup does not expose localStorage; stub a tiny one. */
function stubLocalStorage(): void {
  const memory = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => memory.get(k) ?? null,
    setItem: (k: string, v: string) => void memory.set(k, v),
    removeItem: (k: string) => void memory.delete(k),
    clear: () => memory.clear(),
    key: (i: number) => [...memory.keys()][i] ?? null,
    get length() {
      return memory.size
    },
  })
}

beforeEach(() => {
  stubLocalStorage()
  libraryStore.set(emptyLibrary())
})

describe('favorites', () => {
  it('toggles song favorites', () => {
    expect(toggleFavoriteSong('s-tl-1')).toBe(true)
    expect(isFavoriteSong('s-tl-1')).toBe(true)
    expect(libraryStore.get().favoriteSongIds).toContain('s-tl-1')
    expect(toggleFavoriteSong('s-tl-1')).toBe(false)
    expect(isFavoriteSong('s-tl-1')).toBe(false)
  })

  it('toggles album favorites', () => {
    expect(toggleAlbumFavorite('al-tidal-lines')).toBe(true)
    expect(isFavoriteAlbum('al-tidal-lines')).toBe(true)
    expect(toggleAlbumFavorite('al-tidal-lines')).toBe(false)
    expect(isFavoriteAlbum('al-tidal-lines')).toBe(false)
  })
})

describe('playlists', () => {
  it('creates, renames and deletes playlists', () => {
    const pl = createPlaylist('Road Trip')
    expect(pl.isUserPlaylist).toBe(true)
    expect(getUserPlaylist(pl.id)?.title).toBe('Road Trip')

    updatePlaylist(pl.id, { title: 'Long Drives' })
    expect(getUserPlaylist(pl.id)?.title).toBe('Long Drives')

    deletePlaylist(pl.id)
    expect(getUserPlaylist(pl.id)).toBeUndefined()
  })

  it('adds songs without duplicates', () => {
    const pl = createPlaylist('Mix')
    expect(addSongsToPlaylist(pl.id, ['s-tl-1', 's-tl-2'])).toBe(2)
    expect(addSongsToPlaylist(pl.id, ['s-tl-2'])).toBe(0)
    expect(getUserPlaylist(pl.id)?.songIds).toEqual(['s-tl-1', 's-tl-2'])
  })

  it('removes and reorders songs', () => {
    const pl = createPlaylist('Mix')
    addSongsToPlaylist(pl.id, ['a', 'b', 'c'])
    removeSongFromPlaylist(pl.id, 'b')
    expect(getUserPlaylist(pl.id)?.songIds).toEqual(['a', 'c'])

    movePlaylistSong(pl.id, 1, 0)
    expect(getUserPlaylist(pl.id)?.songIds).toEqual(['c', 'a'])
  })
})

describe('recently played', () => {
  it('records and dedupes plays, most recent first', () => {
    recordPlayed('s-tl-1', 'al-tidal-lines')
    recordPlayed('s-ps-1')
    recordPlayed('s-tl-1')
    const { recentlyPlayed, recentlyAddedAlbumIds } = libraryStore.get()
    expect(recentlyPlayed[0]?.songId).toBe('s-tl-1')
    expect(recentlyPlayed).toHaveLength(2)
    expect(recentlyAddedAlbumIds[0]).toBe('al-tidal-lines')
  })
})
