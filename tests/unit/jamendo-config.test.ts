import { describe, expect, it } from 'vitest'
import { describeJamendoConfig, isJamendoConfigured, parseJamendoConfig } from '@/data/jamendo-config'

describe('parseJamendoConfig', () => {
  it('defaults to enabled with no client id (offered only once an id exists)', () => {
    expect(parseJamendoConfig({})).toEqual({ enabled: true, clientId: '' })
  })

  it('treats only plain opt-out values as disabled', () => {
    for (const value of ['0', 'false', 'FALSE', 'no', 'off', ' Off ']) {
      expect(parseJamendoConfig({ enabled: value }).enabled).toBe(false)
    }
    for (const value of ['1', 'true', 'yes', '', undefined]) {
      expect(parseJamendoConfig({ enabled: value }).enabled).toBe(true)
    }
  })

  it('trims the client id and never invents one', () => {
    expect(parseJamendoConfig({ clientId: '  jm-test-id  ' }).clientId).toBe('jm-test-id')
    expect(parseJamendoConfig({ clientId: '   ' }).clientId).toBe('')
  })
})

describe('isJamendoConfigured', () => {
  it('requires both the enable flag and a client id', () => {
    expect(isJamendoConfigured(parseJamendoConfig({ clientId: 'abc' }))).toBe(true)
    expect(isJamendoConfigured(parseJamendoConfig({}))).toBe(false)
    expect(isJamendoConfigured(parseJamendoConfig({ clientId: 'abc', enabled: '0' }))).toBe(false)
  })
})

describe('describeJamendoConfig', () => {
  it('names the exact knob for each unavailable state', () => {
    expect(describeJamendoConfig(parseJamendoConfig({ enabled: '0', clientId: 'abc' }))).toContain(
      'VITE_JAMENDO_ENABLED',
    )
    expect(describeJamendoConfig(parseJamendoConfig({}))).toContain('VITE_JAMENDO_CLIENT_ID')
    expect(describeJamendoConfig(parseJamendoConfig({}))).toContain('devportal.jamendo.com')
    expect(describeJamendoConfig(parseJamendoConfig({ clientId: 'abc' }))).toContain('enabled')
  })
})
