import { describe, expect, it } from 'vitest'
import { ALBUMS, ARTISTS, GENRES, PLAYLISTS, SONGS, STATIONS } from '@/data/demo-catalog'

describe('demo catalogue integrity', () => {
  it('has unique ids across entities', () => {
    const ids = [...ARTISTS, ...ALBUMS, ...SONGS, ...PLAYLISTS, ...STATIONS, ...GENRES].map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('every song resolves its album and artist', () => {
    const albumIds = new Set(ALBUMS.map((a) => a.id))
    const artistIds = new Set(ARTISTS.map((a) => a.id))
    for (const s of SONGS) {
      expect(albumIds.has(s.albumId)).toBe(true)
      for (const a of s.artistIds) expect(artistIds.has(a)).toBe(true)
      expect(s.audioUrl.startsWith('https://')).toBe(true)
    }
  })

  it('album songIds match their songs', () => {
    for (const album of ALBUMS) {
      const songs = SONGS.filter((s) => s.albumId === album.id)
      expect(songs.map((s) => s.id)).toEqual(album.songIds)
    }
  })

  it('playlist and station song ids all resolve', () => {
    const songIds = new Set(SONGS.map((s) => s.id))
    for (const pl of [...PLAYLISTS, ...STATIONS]) {
      for (const id of pl.songIds) expect(songIds.has(id)).toBe(true)
    }
  })

  it('artists reference known genres', () => {
    const genreIds = new Set(GENRES.map((g) => g.id))
    for (const a of ARTISTS) {
      for (const g of a.genreIds) expect(genreIds.has(g)).toBe(true)
    }
  })
})
