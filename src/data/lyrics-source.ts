/**
 * Remote lyrics (LRCLIB via the Realaxify API) — lookup + LRC parsing.
 *
 * Used only when a song has no embedded lyrics (the demo catalogue's
 * originals always win). The lookup is signature-based: title + artist byline
 * + album + duration, which is exactly what LRCLIB matches on (duration
 * within ±2 seconds). Results — including misses — are cached per song id for
 * the session so a playing track never re-queries on every tick.
 *
 * Attribution: LRCLIB is a free, open lyrics database; whenever its lyrics
 * are displayed the UI links back to lrclib.net.
 */

import type { LyricLine, Song } from '@/domain/types'
import { apiAvailable, apiGetLyrics } from '@/data/api-client'
import { albumById, artistName } from '@/data/catalog-helpers'

export const LRCLIB_NAME = 'LRCLIB'
export const LRCLIB_URL = 'https://lrclib.net'

/** Per-song cache: lines, or 'none' for a known miss. */
const cache = new Map<string, LyricLine[] | 'none'>()

/** Test hook. */
export function clearLyricsCache(): void {
  cache.clear()
}

/**
 * Parse LRC text (`[mm:ss.xx] line`, multiple timestamps per line allowed)
 * into the domain's `LyricLine[]`. Metadata tags (`[ar:…]`, `[ti:…]`) and
 * lines without a timestamp are skipped; output is time-ordered.
 */
export function parseLrc(lrc: string): LyricLine[] {
  const lines: LyricLine[] = []
  for (const raw of lrc.split(/\r?\n/)) {
    const stamps = [...raw.matchAll(/\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g)]
    if (!stamps.length) continue
    const text = raw.replace(/\[[^\]]*\]/g, '').trim()
    if (!text) continue
    for (const stamp of stamps) {
      const minutes = Number(stamp[1])
      const seconds = Number(stamp[2])
      const fraction = (stamp[3] ?? '0').padEnd(3, '0').slice(0, 3)
      if (!Number.isFinite(minutes) || !Number.isFinite(seconds)) continue
      lines.push({ t: minutes * 60_000 + seconds * 1_000 + Number(fraction), text })
    }
  }
  return lines.sort((a, b) => a.t - b.t)
}

export interface LyricsSource {
  lines: LyricLine[]
  attributionName?: string
  attributionUrl?: string
  instrumental: boolean
}

/**
 * Lyrics for a song: embedded originals first, then one LRCLIB lookup.
 * Returns `null` for a known miss; throws only on transport failure (the
 * caller treats that the same as a miss, but does not cache it).
 */
export async function resolveLyrics(song: Song): Promise<LyricsSource | null> {
  if (song.lyrics?.length) {
    return { lines: song.lyrics, instrumental: false }
  }
  const cached = cache.get(song.id)
  if (cached) return cached === 'none' ? null : { lines: cached, instrumental: false }
  if (!(await apiAvailable())) return null

  const artist = artistName(song.artistIds[0])
  if (!artist) return null // LRCLIB requires an artist byline to match
  const album = albumById(song.albumId)?.title
  const response = await apiGetLyrics({
    trackName: song.title,
    artistName: artist,
    albumName: album,
    durationSeconds: song.durationMs > 0 ? Math.round(song.durationMs / 1000) : undefined,
  })
  if (response.instrumental) {
    cache.set(song.id, 'none')
    return { lines: [], instrumental: true, attributionName: response.attributionName, attributionUrl: response.attributionUrl }
  }
  const lines = response.syncedLyrics
    ? parseLrc(response.syncedLyrics)
    : response.plainLyrics
      ? response.plainLyrics
          .split(/\r?\n/)
          .filter((text) => text.trim().length > 0)
          // Unsynchronised text: no timestamps, so no line is ever "active".
          .map((text) => ({ t: Number.POSITIVE_INFINITY, text: text.trim() }))
      : []
  if (!lines.length) {
    cache.set(song.id, 'none')
    return null
  }
  cache.set(
    song.id,
    lines.map((line) => ({ ...line })),
  )
  return {
    lines,
    instrumental: false,
    attributionName: response.attributionName ?? LRCLIB_NAME,
    attributionUrl: response.attributionUrl ?? LRCLIB_URL,
  }
}
