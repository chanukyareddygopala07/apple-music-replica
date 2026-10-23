import { describe, expect, it } from 'vitest'
import { isAudiusConfigured, describeAudiusConfig, parseAudiusConfig } from '@/data/audius-config'

describe('parseAudiusConfig', () => {
  it('is enabled by default (absent or empty flag)', () => {
    expect(parseAudiusConfig({})).toEqual({ enabled: true, apiKey: '' })
    expect(parseAudiusConfig({ enabled: '' })).toEqual({ enabled: true, apiKey: '' })
  })

  it('disables only on explicit opt-out values', () => {
    for (const value of ['0', 'false', 'FALSE', 'no', 'off', ' OFF ']) {
      expect(parseAudiusConfig({ enabled: value }).enabled).toBe(false)
    }
    expect(parseAudiusConfig({ enabled: '1' }).enabled).toBe(true)
    expect(parseAudiusConfig({ enabled: 'yes' }).enabled).toBe(true)
  })

  it('trims an optional api key', () => {
    expect(parseAudiusConfig({ apiKey: '  key123  ' }).apiKey).toBe('key123')
  })
})

describe('describeAudiusConfig / isAudiusConfigured', () => {
  it('describes the state without exposing the key', () => {
    const withKey = parseAudiusConfig({ apiKey: 'sekrit' })
    expect(describeAudiusConfig(withKey)).toContain('API key set')
    expect(describeAudiusConfig(withKey)).not.toContain('sekrit')
    expect(describeAudiusConfig(parseAudiusConfig({}))).toContain('anonymous')
    expect(describeAudiusConfig(parseAudiusConfig({ enabled: '0' }))).toContain('Disabled')
  })

  it('mirrors the enabled flag', () => {
    expect(isAudiusConfigured(parseAudiusConfig({}))).toBe(true)
    expect(isAudiusConfigured(parseAudiusConfig({ enabled: '0' }))).toBe(false)
  })
})
