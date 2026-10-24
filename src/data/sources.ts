/**
 * Source selector options + per-source language capability (pure — no I/O).
 *
 * The selector list is built from what the facade can actually search
 * (availableSources) — sources not wired into this build's catalogue never
 * appear as working options.
 *
 * Language capability is a truth table, not a guess: a source only accepts a
 * specific language filter when the provider has a documented one.
 * - jamendo  — `lang` (2-letter lyrics language, docs.v3.0/tracks)
 * - youtube  — `relevanceLanguage` (ISO 639-1, YouTube Data API search/list)
 * - demo     — the fictional catalogue is English only, so it matches `en`
 * - audius   — no language parameter exists → never claims one
 * - musickit — no language filter implemented here → never claims one
 * Sources without a filter are hidden (and listed) when a language ≠ all is
 * selected, so results are never presented as language-matched when they
 * are not.
 */

import type { CatalogSource, SourceFilter } from '@/domain/types'
import { ALL_LANGUAGES, languageByCode } from '@/data/languages'

/** Canonical group order used by the facade (demo always last). */
export const SOURCE_ORDER: CatalogSource[] = ['audius', 'jamendo', 'youtube', 'musickit', 'demo']

/** Selector options: `all` first, then the sources this build can search. */
export function sourceFilterOptions(available: readonly CatalogSource[]): SourceFilter[] {
  return ['all', ...available]
}

const LABELS: Record<CatalogSource, string> = {
  audius: 'Audius',
  jamendo: 'Jamendo',
  youtube: 'YouTube',
  musickit: 'Apple Music',
  demo: 'Sonora Demo',
}

export function sourceLabel(source: SourceFilter): string {
  return source === 'all' ? 'All sources' : LABELS[source]
}

export function sourceName(source: CatalogSource): string {
  return LABELS[source]
}

export function isSourceFilter(raw: string | null | undefined): raw is SourceFilter {
  return raw === 'all' || raw === 'demo' || raw === 'audius' || raw === 'jamendo' || raw === 'youtube' || raw === 'musickit'
}

/** Valid selector value, else `all`. */
export function normalizeSourceFilter(raw: string | null | undefined): SourceFilter {
  return isSourceFilter(raw) ? raw : 'all'
}

/**
 * True when `source` can apply `language` honestly (see module header).
 * `all` always passes — no filter is being claimed.
 */
export function sourceSupportsLanguage(source: CatalogSource, language: string): boolean {
  if (language === ALL_LANGUAGES) return true
  switch (source) {
    case 'jamendo':
    case 'youtube':
      // Wire values are ISO 639-1 only; `other` (and any future no-ISO code)
      // cannot be sent, so the source steps aside instead of guessing.
      return Boolean(languageByCode(language)?.iso)
    case 'demo':
      return language === 'en'
    case 'audius':
    case 'musickit':
      return false
  }
}
