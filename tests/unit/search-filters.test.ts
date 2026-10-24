import { describe, expect, it } from 'vitest'
import {
  ALL_LANGUAGES,
  LANGUAGES,
  jamendoLanguage,
  languageLabel,
  normalizeLanguage,
  songMatchesLanguage,
  youtubeLanguage,
} from '@/data/languages'
import {
  SOURCE_ORDER,
  normalizeSourceFilter,
  sourceFilterOptions,
  sourceLabel,
  sourceSupportsLanguage,
} from '@/data/sources'

describe('language options', () => {
  it('defaults to All languages and offers Chinese + Other languages', () => {
    expect(LANGUAGES[0]).toEqual({ code: ALL_LANGUAGES, label: 'All languages' })
    expect(LANGUAGES.filter((l) => l.code === 'zh')).toHaveLength(1)
    expect(LANGUAGES.filter((l) => l.code === 'other')).toHaveLength(1)
    expect(LANGUAGES[LANGUAGES.length - 1]?.code).toBe('other')
  })

  it('carries a real ISO 639-1 code for every option except all/other', () => {
    for (const l of LANGUAGES) {
      if (l.code === 'all' || l.code === 'other') expect(l.iso).toBeUndefined()
      else expect(l.iso).toMatch(/^[a-z]{2}$/)
    }
  })

  it('never lets an unknown code reach a provider', () => {
    expect(normalizeLanguage('fr')).toBe('fr')
    expect(normalizeLanguage('klingon')).toBe(ALL_LANGUAGES)
    expect(normalizeLanguage(null)).toBe(ALL_LANGUAGES)
    expect(languageLabel('klingon')).toBe('All languages')
  })

  it('maps provider wire values without inventing codes', () => {
    expect(jamendoLanguage('en')).toBe('en')
    expect(jamendoLanguage('zh-Hans')).toBe('zh')
    expect(jamendoLanguage('other')).toBeUndefined()
    expect(jamendoLanguage(ALL_LANGUAGES)).toBeUndefined()
    expect(youtubeLanguage('zh-Hans')).toBe('zh-Hans')
    expect(youtubeLanguage('fr')).toBe('fr')
    expect(youtubeLanguage('other')).toBeUndefined()
  })
})

describe('songMatchesLanguage', () => {
  const tagged = { language: 'en' }
  const unknown = {}

  it('passes every track while the filter is all', () => {
    expect(songMatchesLanguage(tagged, 'all')).toBe(true)
    expect(songMatchesLanguage(unknown, 'all')).toBe(true)
  })

  it('keeps unknown-language tracks under any filter (never falsely excluded)', () => {
    expect(songMatchesLanguage(unknown, 'fr')).toBe(true)
  })

  it('matches only the exact code once a track states its language', () => {
    expect(songMatchesLanguage(tagged, 'en')).toBe(true)
    expect(songMatchesLanguage(tagged, 'fr')).toBe(false)
  })
})

describe('source selector options', () => {
  it('puts all first, then the sources the build can search', () => {
    expect(sourceFilterOptions(['audius', 'demo'])).toEqual(['all', 'audius', 'demo'])
    expect(sourceFilterOptions(['demo'])).toEqual(['all', 'demo'])
    expect(sourceFilterOptions([])).toEqual(['all'])
  })

  it('normalises unknown values to all', () => {
    expect(normalizeSourceFilter('demo')).toBe('demo')
    expect(normalizeSourceFilter('spotify')).toBe('all')
    expect(normalizeSourceFilter(undefined)).toBe('all')
  })

  it('labels the selector values', () => {
    expect(sourceLabel('all')).toBe('All sources')
    expect(sourceLabel('demo')).toBe('Sonora Demo')
    expect(sourceLabel('musickit')).toBe('Apple Music')
  })
})

describe('sourceSupportsLanguage (truth table)', () => {
  it('all never restricts anything', () => {
    for (const source of SOURCE_ORDER) expect(sourceSupportsLanguage(source, ALL_LANGUAGES)).toBe(true)
  })

  it('demo is English-only; audius and musickit claim no language filter', () => {
    expect(sourceSupportsLanguage('demo', 'en')).toBe(true)
    expect(sourceSupportsLanguage('demo', 'es')).toBe(false)
    expect(sourceSupportsLanguage('audius', 'en')).toBe(false)
    expect(sourceSupportsLanguage('musickit', 'en')).toBe(false)
  })

  it('jamendo/youtube only accept codes that carry an ISO value', () => {
    expect(sourceSupportsLanguage('jamendo', 'es')).toBe(true)
    expect(sourceSupportsLanguage('youtube', 'zh-Hans')).toBe(true)
    expect(sourceSupportsLanguage('jamendo', 'other')).toBe(false)
    expect(sourceSupportsLanguage('youtube', 'other')).toBe(false)
  })
})
