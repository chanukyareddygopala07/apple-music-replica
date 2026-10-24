import { afterEach, describe, expect, it, vi } from 'vitest'
import { describeYoutubeConfig, isYoutubeConfigured, parseYoutubeConfig, readYoutubeConfig } from '@/data/youtube-config'

describe('parseYoutubeConfig', () => {
  it('defaults to enabled with no API key (offered only once a key exists)', () => {
    expect(parseYoutubeConfig({})).toEqual({ enabled: true, apiKey: '' })
  })

  it('treats only plain opt-out values as disabled', () => {
    for (const value of ['0', 'false', 'FALSE', 'no', 'off', ' Off ']) {
      expect(parseYoutubeConfig({ enabled: value }).enabled).toBe(false)
    }
    for (const value of ['1', 'true', 'yes', '', undefined]) {
      expect(parseYoutubeConfig({ enabled: value }).enabled).toBe(true)
    }
  })

  it('trims the API key and never invents one', () => {
    expect(parseYoutubeConfig({ apiKey: '  AIza-test  ' }).apiKey).toBe('AIza-test')
    expect(parseYoutubeConfig({ apiKey: '   ' }).apiKey).toBe('')
  })
})

describe('isYoutubeConfigured', () => {
  it('requires both the enable flag and an API key', () => {
    expect(isYoutubeConfigured(parseYoutubeConfig({ apiKey: 'abc' }))).toBe(true)
    expect(isYoutubeConfigured(parseYoutubeConfig({}))).toBe(false)
    expect(isYoutubeConfigured(parseYoutubeConfig({ apiKey: 'abc', enabled: '0' }))).toBe(false)
  })
})

describe('describeYoutubeConfig', () => {
  it('names the exact knob for each unavailable state', () => {
    expect(describeYoutubeConfig(parseYoutubeConfig({ enabled: '0', apiKey: 'abc' }))).toContain(
      'VITE_YOUTUBE_ENABLED',
    )
    expect(describeYoutubeConfig(parseYoutubeConfig({}))).toContain('VITE_YOUTUBE_API_KEY')
    expect(describeYoutubeConfig(parseYoutubeConfig({}))).toContain('YouTube Data API v3')
    expect(describeYoutubeConfig(parseYoutubeConfig({ apiKey: 'abc' }))).toContain('API key set')
  })
})

describe('readYoutubeConfig (import.meta.env wiring)', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('reads VITE_YOUTUBE_* through the literal env read', () => {
    vi.stubEnv('VITE_YOUTUBE_API_KEY', 'env-key')
    vi.stubEnv('VITE_YOUTUBE_ENABLED', '1')
    expect(readYoutubeConfig()).toEqual({ enabled: true, apiKey: 'env-key' })

    vi.stubEnv('VITE_YOUTUBE_ENABLED', '0')
    expect(readYoutubeConfig().enabled).toBe(false)

    vi.unstubAllEnvs()
    expect(readYoutubeConfig()).toEqual({ enabled: true, apiKey: '' })
  })
})
