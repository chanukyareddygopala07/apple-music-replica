import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearDiscoveredPool,
  discoveredSongs,
  rememberDiscoveredSongs,
  shelvesByLanguage,
} from '@/data/discovery-pool'
import type { Song } from '@/domain/types'

function song(overrides: Partial<Song> & { id: string }): Song {
  return {
    title: 'A Song',
    albumId: 'alb-1',
    artistIds: ['art-1'],
    durationMs: 200_000,
    trackNumber: 1,
    audioUrl: 'https://cdn.example/track.mp3',
    source: 'jamendo',
    playbackKind: 'audio',
    artworkUrl: 'https://cdn.example/cover.jpg',
    externalUrl: 'https://example/track',
    ...overrides,
  }
}

const teluguOne = song({ id: 'jm-te-1', language: 'te' })
const teluguTwo = song({ id: 'jm-te-2', language: 'te' })
const hindiOne = song({ id: 'jm-hi-1', language: 'hi' })
const tamilOne = song({ id: 'jm-ta-1', language: 'ta' })
const englishOne = song({ id: 'jm-en-1', language: 'en' })
const unknownLang = song({ id: 'jm-xx-1' })
const unmappable = song({ id: 'jm-yy-1', language: 'ceb' })
const ytTelugu = song({ id: 'yt-te000000001', source: 'youtube', playbackKind: 'youtube', language: 'te' })

beforeEach(() => clearDiscoveredPool())

describe('rememberDiscoveredSongs', () => {
  it('keeps only songs whose language maps to the catalogue', () => {
    rememberDiscoveredSongs([teluguOne, unknownLang, unmappable, englishOne])
    expect(discoveredSongs().map((s) => s.id)).toEqual(['jm-te-1', 'jm-en-1'])
  })

  it('dedupes by id, keeping the newest record', () => {
    rememberDiscoveredSongs([teluguOne])
    rememberDiscoveredSongs([{ ...teluguOne, title: 'Remastered' }])
    const kept = discoveredSongs()
    expect(kept).toHaveLength(1)
    expect(kept[0]?.title).toBe('Remastered')
  })

  it('caps the pool at 400 songs, evicting the oldest first', () => {
    const many = Array.from({ length: 410 }, (_, i) => song({ id: `jm-${i}`, language: 'en' }))
    rememberDiscoveredSongs(many)
    expect(discoveredSongs()).toHaveLength(400)
    expect(discoveredSongs().some((s) => s.id === 'jm-0')).toBe(false)
    expect(discoveredSongs().some((s) => s.id === 'jm-409')).toBe(true)
  })

  it('clearDiscoveredPool empties it', () => {
    rememberDiscoveredSongs([teluguOne])
    clearDiscoveredPool()
    expect(discoveredSongs()).toEqual([])
  })
})

describe('shelvesByLanguage', () => {
  it('groups by mapped code with catalogue labels', () => {
    rememberDiscoveredSongs([teluguOne, teluguTwo, hindiOne])
    const shelves = shelvesByLanguage()
    expect(shelves.map((s) => [s.code, s.label, s.songs.length])).toEqual([
      ['te', 'Telugu', 2],
      ['hi', 'Hindi', 1],
    ])
  })

  it('shelves Telugu/Hindi/Tamil together and never shelves unclassified tracks', () => {
    rememberDiscoveredSongs([teluguOne, hindiOne, tamilOne, unmappable, unknownLang])
    const shelves = shelvesByLanguage()
    // Equal counts tie-break on catalogue order: hi, ta, te.
    expect(shelves.map((s) => [s.code, s.label])).toEqual([
      ['hi', 'Hindi'],
      ['ta', 'Tamil'],
      ['te', 'Telugu'],
    ])
    const ids = shelves.flatMap((s) => s.songs.map((x) => x.id))
    expect(ids).toEqual(['jm-hi-1', 'jm-ta-1', 'jm-te-1'])
  })

  it('sorts richest shelves first, catalogue order breaking ties', () => {
    rememberDiscoveredSongs([hindiOne, englishOne, teluguOne, teluguTwo])
    // te has the most songs; en vs hi ties break on catalogue order (en first).
    expect(shelvesByLanguage().map((s) => s.code)).toEqual(['te', 'en', 'hi'])
  })

  it('never builds a shelf from unknown or unmappable languages', () => {
    rememberDiscoveredSongs([unknownLang, unmappable])
    expect(shelvesByLanguage()).toEqual([])
  })

  it('never labels a shelf "All languages"', () => {
    rememberDiscoveredSongs([song({ id: 'x', language: 'all' }), song({ id: 'y', language: 'other' })])
    expect(shelvesByLanguage().every((s) => s.label !== 'All languages')).toBe(true)
  })

  it('prefers non-YouTube songs in a mixed language (no provider blending)', () => {
    rememberDiscoveredSongs([teluguOne, ytTelugu])
    const shelves = shelvesByLanguage()
    expect(shelves).toHaveLength(1)
    expect(shelves[0]?.songs.map((s) => s.id)).toEqual(['jm-te-1'])
  })

  it('falls back to YouTube-only when no other provider has the language', () => {
    rememberDiscoveredSongs([ytTelugu, { ...ytTelugu, id: 'yt-te000000002' }])
    const shelves = shelvesByLanguage()
    expect(shelves).toHaveLength(1)
    expect(shelves[0]?.songs.every((s) => s.source === 'youtube')).toBe(true)
  })

  it('accepts an explicit song list without touching the session pool', () => {
    rememberDiscoveredSongs([englishOne])
    const shelves = shelvesByLanguage([teluguOne, { ...unknownLang, language: 'zh-Hans-CN' }])
    expect(shelves.map((s) => s.code)).toEqual(['te', 'zh-Hans'])
    expect(discoveredSongs().map((s) => s.id)).toEqual(['jm-en-1'])
  })
})
