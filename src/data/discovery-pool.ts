/**
 * Session language-discovery pool (pure store — no I/O).
 *
 * Language-bearing tracks seen anywhere in the session (the Home YouTube
 * discovery, grouped searches, the Home feed) accumulate here so the Home
 * "Explore by Language" shelves can be built without extra provider
 * requests — Home never searches once per language (quota rule: YouTube
 * search.list is 100 units of Google's 10,000/day).
 *
 * Only tracks whose language maps onto the app's language catalogue are
 * remembered; everything else keeps flowing through the rest of the UI
 * unlabelled rather than being guessed into a shelf.
 *
 * Shelf composition never blends YouTube with another provider in one list
 * (data/catalog.ts `aggregatedInAll` policy): a language whose only tracks
 * are YouTube's gets a YouTube-only shelf; where other providers have
 * language-tagged tracks, those are preferred and the YouTube duplicates
 * stay in the dedicated YouTube Music section.
 */

import type { Song } from '@/domain/types'
import { LANGUAGES, languageLabel, normalizeTrackLanguage } from '@/data/languages'

/** Bounded memory: oldest entries fall out first (insertion order). */
const MAX_POOL = 400

const pool = new Map<string, Song>()

/** Remember language-bearing tracks (deduped by id); others are skipped. */
export function rememberDiscoveredSongs(songs: readonly Song[]): void {
  for (const song of songs) {
    if (!song?.id || !normalizeTrackLanguage(song.language)) continue
    if (pool.has(song.id)) {
      pool.set(song.id, song)
      continue
    }
    if (pool.size >= MAX_POOL) {
      const oldest = pool.keys().next().value
      if (oldest !== undefined) pool.delete(oldest)
    }
    pool.set(song.id, song)
  }
}

/** Snapshot of the remembered tracks (insertion order). */
export function discoveredSongs(): Song[] {
  return [...pool.values()]
}

/** Test hook: forget every remembered track. */
export function clearDiscoveredPool(): void {
  pool.clear()
}

export interface LanguageShelf {
  /** App-level code of the shelf (`te`, `hi`, …). */
  code: string
  /** Human label from the language catalogue (`Telugu`). */
  label: string
  /** Language-tagged tracks for the shelf (never mixed across YouTube). */
  songs: Song[]
}

const CATALOG_ORDER = new Map(LANGUAGES.map((opt, index) => [opt.code, index]))

/**
 * Group tracks by their declared language — one shelf per language, richest
 * first (catalogue order breaks ties). Tracks without a mappable language
 * are excluded: they stay visible elsewhere, never forced into a wrong shelf.
 */
export function shelvesByLanguage(songs: Song[] = discoveredSongs()): LanguageShelf[] {
  const buckets = new Map<string, Song[]>()
  for (const song of songs) {
    const code = normalizeTrackLanguage(song.language)
    if (!code) continue
    const bucket = buckets.get(code)
    if (bucket) bucket.push(song)
    else buckets.set(code, [song])
  }
  const shelves: LanguageShelf[] = []
  for (const [code, bucket] of buckets) {
    const label = languageLabel(code)
    if (label === 'All languages') continue // defensive: 'all' is not a shelf
    const others = bucket.filter((s) => s.source !== 'youtube')
    const chosen = others.length > 0 ? others : bucket
    shelves.push({ code, label, songs: chosen })
  }
  shelves.sort(
    (a, b) => b.songs.length - a.songs.length || (CATALOG_ORDER.get(a.code) ?? 0) - (CATALOG_ORDER.get(b.code) ?? 0),
  )
  return shelves
}
