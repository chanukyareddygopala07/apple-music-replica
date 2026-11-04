/**
 * Language filter options for multilingual search (pure — no I/O).
 *
 * The app-level `code` is what the UI stores (prefs) and puts in the URL.
 * Each option carries the wire values the providers expect:
 * - Jamendo `lang`        — "standard 2 letters format" (docs.v3.0/tracks)
 * - YouTube `relevanceLanguage` — "typically ISO 639-1 two-letter… use
 *   `zh-Hans` / `zh-Hant` for Chinese" (YouTube Data API search/list)
 * `all` carries neither: it means no language filter anywhere.
 *
 * Codes are only listed when a real two-letter ISO 639-1 value exists — no
 * invented codes, so both providers receive valid filters. `other` is the one
 * exception with no ISO value at all: it is a UI-only "not listed above"
 * bucket, and a source only accepts it when it can filter without one.
 */

import type { Song } from '@/domain/types'

export const ALL_LANGUAGES = 'all'

export interface LanguageOption {
  /** App-level code stored in prefs / URL (`all`, `en`, `zh-Hans`, …). */
  code: string
  /** Human label for the selector. */
  label: string
  /** ISO 639-1 value sent to Jamendo's `lang` (absent for `all`). */
  iso?: string
  /** Value sent to YouTube's `relevanceLanguage` (defaults to `iso`). */
  relevance?: string
}

/** Curated list: app-level codes (`all` / `other` carry no ISO value). */
export const LANGUAGES: LanguageOption[] = [
  { code: ALL_LANGUAGES, label: 'All languages' },
  { code: 'en', label: 'English', iso: 'en' },
  { code: 'es', label: 'Spanish', iso: 'es' },
  { code: 'fr', label: 'French', iso: 'fr' },
  { code: 'de', label: 'German', iso: 'de' },
  { code: 'it', label: 'Italian', iso: 'it' },
  { code: 'pt', label: 'Portuguese', iso: 'pt' },
  { code: 'nl', label: 'Dutch', iso: 'nl' },
  { code: 'sv', label: 'Swedish', iso: 'sv' },
  { code: 'no', label: 'Norwegian', iso: 'no' },
  { code: 'da', label: 'Danish', iso: 'da' },
  { code: 'fi', label: 'Finnish', iso: 'fi' },
  { code: 'is', label: 'Icelandic', iso: 'is' },
  { code: 'pl', label: 'Polish', iso: 'pl' },
  { code: 'cs', label: 'Czech', iso: 'cs' },
  { code: 'sk', label: 'Slovak', iso: 'sk' },
  { code: 'hu', label: 'Hungarian', iso: 'hu' },
  { code: 'ro', label: 'Romanian', iso: 'ro' },
  { code: 'bg', label: 'Bulgarian', iso: 'bg' },
  { code: 'el', label: 'Greek', iso: 'el' },
  { code: 'sr', label: 'Serbian', iso: 'sr' },
  { code: 'hr', label: 'Croatian', iso: 'hr' },
  { code: 'sl', label: 'Slovenian', iso: 'sl' },
  { code: 'lt', label: 'Lithuanian', iso: 'lt' },
  { code: 'lv', label: 'Latvian', iso: 'lv' },
  { code: 'et', label: 'Estonian', iso: 'et' },
  { code: 'uk', label: 'Ukrainian', iso: 'uk' },
  { code: 'ru', label: 'Russian', iso: 'ru' },
  { code: 'tr', label: 'Turkish', iso: 'tr' },
  { code: 'ar', label: 'Arabic', iso: 'ar' },
  { code: 'he', label: 'Hebrew', iso: 'he' },
  { code: 'fa', label: 'Persian', iso: 'fa' },
  { code: 'ur', label: 'Urdu', iso: 'ur' },
  { code: 'hi', label: 'Hindi', iso: 'hi' },
  { code: 'bn', label: 'Bengali', iso: 'bn' },
  { code: 'ta', label: 'Tamil', iso: 'ta' },
  { code: 'te', label: 'Telugu', iso: 'te' },
  { code: 'mr', label: 'Marathi', iso: 'mr' },
  { code: 'gu', label: 'Gujarati', iso: 'gu' },
  { code: 'kn', label: 'Kannada', iso: 'kn' },
  { code: 'ml', label: 'Malayalam', iso: 'ml' },
  { code: 'pa', label: 'Punjabi', iso: 'pa' },
  { code: 'zh', label: 'Chinese', iso: 'zh' },
  { code: 'zh-Hans', label: 'Chinese (Simplified)', iso: 'zh', relevance: 'zh-Hans' },
  { code: 'zh-Hant', label: 'Chinese (Traditional)', iso: 'zh', relevance: 'zh-Hant' },
  { code: 'ja', label: 'Japanese', iso: 'ja' },
  { code: 'ko', label: 'Korean', iso: 'ko' },
  { code: 'vi', label: 'Vietnamese', iso: 'vi' },
  { code: 'th', label: 'Thai', iso: 'th' },
  { code: 'id', label: 'Indonesian', iso: 'id' },
  { code: 'ms', label: 'Malay', iso: 'ms' },
  { code: 'tl', label: 'Filipino / Tagalog', iso: 'tl' },
  { code: 'my', label: 'Burmese', iso: 'my' },
  { code: 'km', label: 'Khmer', iso: 'km' },
  { code: 'lo', label: 'Lao', iso: 'lo' },
  { code: 'ka', label: 'Georgian', iso: 'ka' },
  { code: 'hy', label: 'Armenian', iso: 'hy' },
  { code: 'az', label: 'Azerbaijani', iso: 'az' },
  { code: 'kk', label: 'Kazakh', iso: 'kk' },
  { code: 'uz', label: 'Uzbek', iso: 'uz' },
  { code: 'mn', label: 'Mongolian', iso: 'mn' },
  { code: 'ne', label: 'Nepali', iso: 'ne' },
  { code: 'sw', label: 'Swahili', iso: 'sw' },
  { code: 'af', label: 'Afrikaans', iso: 'af' },
  { code: 'am', label: 'Amharic', iso: 'am' },
  { code: 'so', label: 'Somali', iso: 'so' },
  { code: 'ha', label: 'Hausa', iso: 'ha' },
  { code: 'yo', label: 'Yoruba', iso: 'yo' },
  { code: 'ig', label: 'Igbo', iso: 'ig' },
  { code: 'ca', label: 'Catalan', iso: 'ca' },
  { code: 'eu', label: 'Basque', iso: 'eu' },
  { code: 'gl', label: 'Galician', iso: 'gl' },
  { code: 'other', label: 'Other languages' },
]

const BY_CODE = new Map(LANGUAGES.map((l) => [l.code, l]))

export function languageByCode(code: string): LanguageOption | undefined {
  return BY_CODE.get(code)
}

export function isLanguageCode(raw: string | null | undefined): boolean {
  return typeof raw === 'string' && BY_CODE.has(raw)
}

/** Valid app code, else `all` (never lets an unknown value reach a provider). */
export function normalizeLanguage(raw: string | null | undefined): string {
  return isLanguageCode(raw) ? (raw as string) : ALL_LANGUAGES
}

export function languageLabel(code: string): string {
  return BY_CODE.get(code)?.label ?? 'All languages'
}

/** Value for Jamendo's `lang`; undefined = no filter (`all`). */
export function jamendoLanguage(code: string): string | undefined {
  return BY_CODE.get(code)?.iso
}

/** Value for YouTube's `relevanceLanguage`; undefined = no filter. */
export function youtubeLanguage(code: string): string | undefined {
  const opt = BY_CODE.get(code)
  return opt ? (opt.relevance ?? opt.iso) : undefined
}

/**
 * Provider-declared track language (BCP-47 / ISO 639-1) → app code, or null.
 *
 * Progressive match over the tag's subtags (longest first): app codes are
 * tried for every prefix (`zh-Hans-CN` → `zh-Hans`), then ISO values
 * (`pt-BR` → `pt`). Codes outside the catalogue return null — a language is
 * never invented, so callers never display a wrong label. Mirrors
 * `track_language` in `backend/app/languages.py`.
 */
export function normalizeTrackLanguage(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null
  const value = raw.trim().toLowerCase().replaceAll('_', '-')
  if (!value || value === ALL_LANGUAGES || value === 'other') return null
  const parts = value.split('-').filter(Boolean)
  if (parts.length === 0) return null
  const candidates: string[] = []
  for (let i = parts.length; i > 0; i--) candidates.push(parts.slice(0, i).join('-'))
  for (const candidate of candidates) {
    for (const opt of LANGUAGES) {
      if (opt.iso && opt.code.toLowerCase() === candidate) return opt.code
    }
  }
  for (const candidate of candidates) {
    for (const opt of LANGUAGES) {
      if (opt.iso && opt.iso === candidate) return opt.code
    }
  }
  return null
}

/**
 * Per-track safety net for a selected language filter.
 * - `all`      — no filter, everything matches.
 * - unknown    — no `song.language` → eligible: the track cannot honestly be
 *                excluded, so it stays (documented in the README).
 * - otherwise  — the song's own app-level code must equal the filter.
 */
export function songMatchesLanguage(song: Pick<Song, 'language'>, language: string): boolean {
  if (language === ALL_LANGUAGES) return true
  if (!song.language) return true
  return song.language === language
}
