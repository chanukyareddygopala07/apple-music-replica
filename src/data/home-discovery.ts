/**
 * Home YouTube discovery — one bounded request feeding both Home sections.
 *
 * Quota rule (YouTube search.list = 100 units of Google's 10,000/day): at
 * most ONE discovery request per browser session for the Home view, no
 * per-language searches anywhere. This module guarantees that with:
 *
 * - single-flight: concurrent Home renders share one in-flight search;
 * - a session cache (sessionStorage, 30 min TTL): a reload reuses the last
 *   result instead of spending another quota unit — failures never cache;
 * - pool ingestion: the same songs populate the "Explore by Language"
 *   shelves (data/discovery-pool), so one fetch serves both sections.
 */

import type { Song } from '@/domain/types'
import { searchGrouped } from '@/data/catalog'
import { rememberDiscoveredSongs } from '@/data/discovery-pool'
import { isAbortError } from '@/data/api-client'

/** Generic discovery query (shared with each shelf's "See All" explore link). */
export const HOME_DISCOVERY_QUERY = 'music'

/**
 * One search.list page of 50 costs the same flat 100-unit quota as a page of
 * 20 (Google prices search.list per call, not per result), and the companion
 * videos.list still fits all ids in its single ≤50-id batch — a wider net for
 * language-tagged tracks at no extra quota cost.
 */
export const HOME_DISCOVERY_LIMIT = 50

const CACHE_KEY = 'realaxify:home-discovery:v1'
const CACHE_TTL_MS = 30 * 60_000

export interface HomeDiscoveryResult {
  status: 'ok' | 'empty' | 'error' | 'unavailable'
  /** YouTube songs for the YouTube Music section (may be empty). */
  songs: Song[]
  /** Honest copy for the error/unavailable states. */
  message?: string
}

interface CachedDiscovery {
  t: number
  songs: Song[]
}

let inflight: Promise<HomeDiscoveryResult> | null = null

function readCache(): HomeDiscoveryResult | null {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as CachedDiscovery
    if (typeof parsed?.t !== 'number' || !Array.isArray(parsed.songs)) return null
    if (Date.now() - parsed.t > CACHE_TTL_MS) {
      sessionStorage.removeItem(CACHE_KEY)
      return null
    }
    const songs = parsed.songs.filter((s): s is Song => Boolean(s?.id))
    rememberDiscoveredSongs(songs)
    return { status: songs.length > 0 ? 'ok' : 'empty', songs }
  } catch {
    return null
  }
}

function writeCache(result: HomeDiscoveryResult): void {
  if (result.status !== 'ok' && result.status !== 'empty') return
  try {
    const entry: CachedDiscovery = { t: Date.now(), songs: result.songs }
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(entry))
  } catch {
    /* quota/full/errors — the next visit just spends one search again. */
  }
}

async function runDiscovery(): Promise<HomeDiscoveryResult> {
  try {
    const grouped = await searchGrouped(HOME_DISCOVERY_QUERY, { source: 'youtube', limit: HOME_DISCOVERY_LIMIT })
    const group = grouped.groups[0]
    if (!group) {
      return { status: 'unavailable', songs: [], message: 'YouTube search is unavailable right now.' }
    }
    const songs = group.results.songs
    if (group.status === 'ok' || group.status === 'empty') {
      const result: HomeDiscoveryResult = { status: songs.length > 0 ? 'ok' : 'empty', songs }
      rememberDiscoveredSongs(songs)
      writeCache(result)
      return result
    }
    if (group.status === 'error') {
      return {
        status: 'error',
        songs: [],
        message: group.message ?? 'YouTube search could not be completed.',
      }
    }
    return { status: 'unavailable', songs: [], message: group.message }
  } catch (err) {
    if (isAbortError(err)) throw err
    return { status: 'error', songs: [], message: 'YouTube search could not be completed.' }
  }
}

/**
 * Discover YouTube songs for Home: session-cached, single-flight. Rejected
 * only for cancellation — every real failure resolves into an honest state
 * the view can render with a retry.
 */
export function discoverHomeYouTube(): Promise<HomeDiscoveryResult> {
  const cached = readCache()
  if (cached) return Promise.resolve(cached)
  if (inflight) return inflight
  inflight = runDiscovery().finally(() => {
    inflight = null
  })
  return inflight
}

/** Test hook: forget the in-flight search and the session cache. */
export function resetHomeDiscovery(): void {
  inflight = null
  try {
    sessionStorage.removeItem(CACHE_KEY)
  } catch {
    /* no-op */
  }
}
