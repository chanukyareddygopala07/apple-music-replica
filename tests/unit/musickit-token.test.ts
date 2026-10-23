import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createTokenSource,
  decodeJwtExpSec,
  describeMusicKitConfig,
  isJwtShaped,
  isMusicKitConfigured,
  isValidServiceUrl,
  parseMusicKitConfig,
  readMusicKitConfig,
  staticTokenOf,
  serviceUrlOf,
  TokenError,
  type MusicKitConfig,
} from '@/data/musickit-token'

function b64url(text: string): string {
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Structurally valid ES256-shaped JWT with an absolute `exp` (epoch sec). */
function jwtWithExp(expSec: number): string {
  return `${b64url('{"alg":"ES256","kid":"ABC123DEFG"')}.${b64url(JSON.stringify({ iss: 'TEAMID1234', iat: 1, exp: expSec }))}.c2ln`
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response
}

function cfg(overrides: Partial<MusicKitConfig> = {}): MusicKitConfig {
  return { enabled: true, tokenUrl: 'https://tokens.example/jwt', staticToken: '', ...overrides }
}

const T0 = 1_700_000_000_000 // fixed "now" (ms)

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('configuration gate (two-key)', () => {
  it('is not configured with no configuration at all', () => {
    const c = parseMusicKitConfig({})
    expect(c.enabled).toBe(false)
    expect(isMusicKitConfigured(c)).toBe(false)
  })

  it('requires the explicit flag even when a token URL is set', () => {
    const c = parseMusicKitConfig({ tokenUrl: 'https://tokens.example/jwt' })
    expect(c.enabled).toBe(false)
    expect(isMusicKitConfigured(c)).toBe(false)
    expect(serviceUrlOf(c)).toBeNull()
  })

  it('requires a token source even when the flag is set', () => {
    expect(isMusicKitConfigured(parseMusicKitConfig({ enabled: '1' }))).toBe(false)
  })

  it('accepts common truthy flag spellings case-insensitively', () => {
    for (const v of ['1', 'true', 'TRUE', 'yes', 'On']) {
      const c = parseMusicKitConfig({ enabled: v, tokenUrl: 'https://tokens.example/jwt' })
      expect(isMusicKitConfigured(c), v).toBe(true)
    }
    for (const v of ['0', 'false', 'no', 'off', 'maybe']) {
      const c = parseMusicKitConfig({ enabled: v, tokenUrl: 'https://tokens.example/jwt' })
      expect(isMusicKitConfigured(c), v).toBe(false)
    }
  })

  it('rejects non-http(s) token URLs', () => {
    for (const bad of ['javascript:alert(1)', 'ftp://x/y', 'not a url', 'data:text/plain,x']) {
      expect(isValidServiceUrl(bad), bad).toBe(false)
      const c = parseMusicKitConfig({ enabled: '1', tokenUrl: bad })
      expect(isMusicKitConfigured(c), bad).toBe(false)
    }
    expect(isValidServiceUrl('https://tokens.example/jwt')).toBe(true)
    expect(isValidServiceUrl('http://localhost:8787/token')).toBe(true)
  })

  it('prefers the token service URL over a static token', () => {
    const c = cfg({ staticToken: 'abc.def.ghi' })
    expect(serviceUrlOf(c)).toBe('https://tokens.example/jwt')
    expect(staticTokenOf(c)).toBeNull()
  })

  it('uses the static token only when no service URL is set', () => {
    const c = cfg({ tokenUrl: '', staticToken: 'abc.def.ghi' })
    expect(serviceUrlOf(c)).toBeNull()
    expect(staticTokenOf(c)).toBe('abc.def.ghi')
    expect(isMusicKitConfigured(c)).toBe(true)
  })

  it('reads live import.meta.env values', () => {
    expect(isMusicKitConfigured(readMusicKitConfig())).toBe(false) // credential-less default
    vi.stubEnv('VITE_MUSICKIT_ENABLED', '1')
    vi.stubEnv('VITE_MUSICKIT_TOKEN_URL', 'https://tokens.example/jwt')
    expect(isMusicKitConfigured(readMusicKitConfig())).toBe(true)
    vi.unstubAllEnvs()
    expect(isMusicKitConfigured(readMusicKitConfig())).toBe(false)
  })

  it('describes status without leaking token material', () => {
    const secret = jwtWithExp(4_000_000_000)
    const withToken = describeMusicKitConfig(cfg({ tokenUrl: '', staticToken: secret }))
    expect(withToken).toContain('local development')
    expect(withToken).not.toContain(secret)
    expect(describeMusicKitConfig(parseMusicKitConfig({}))).toContain('Not enabled')
    expect(describeMusicKitConfig(cfg({ tokenUrl: 'nope', staticToken: '' }))).toContain('http(s) URL')
  })
})

describe('JWT helpers', () => {
  it('recognizes JWT shape and decodes exp', () => {
    const token = jwtWithExp(2_000_000_000)
    expect(isJwtShaped(token)).toBe(true)
    expect(decodeJwtExpSec(token)).toBe(2_000_000_000)
  })

  it('rejects malformed input', () => {
    expect(isJwtShaped('')).toBe(false)
    expect(isJwtShaped('one.two')).toBe(false)
    expect(isJwtShaped('a..c')).toBe(false)
    expect(decodeJwtExpSec('one.two')).toBeNull()
    expect(decodeJwtExpSec(`x.${b64url('not json')}.y`)).toBeNull()
    expect(decodeJwtExpSec(`x.${b64url('{"noexp":1}')}.y`)).toBeNull()
  })
})

describe('createTokenSource — not configured', () => {
  it('rejects without any fetch when the gate fails', async () => {
    const fetchFn = vi.fn()
    const source = createTokenSource({ config: parseMusicKitConfig({}), fetchFn })
    await expect(source.getToken()).rejects.toMatchObject({ code: 'not-configured' })
    expect(fetchFn).not.toHaveBeenCalled()
    expect(source.isDynamic).toBe(false)
  })
})

describe('createTokenSource — token service (dynamic)', () => {
  it('fetches a token successfully and caches it until expiry margin', async () => {
    const token = jwtWithExp((T0 + 2 * 3_600_000) / 1000) // valid 2h
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ token }))
    const source = createTokenSource({ config: cfg(), fetchFn, now: () => T0 })

    await expect(source.getToken()).resolves.toBe(token)
    await expect(source.getToken()).resolves.toBe(token)
    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(source.isDynamic).toBe(true)
    const [url, init] = fetchFn.mock.calls[0]!
    expect(url).toBe('https://tokens.example/jwt')
    expect((init as RequestInit).headers).toMatchObject({ Accept: 'application/json' })
  })

  it('deduplicates concurrent requests (single-flight)', async () => {
    const token = jwtWithExp((T0 + 3_600_000) / 1000)
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ token }))
    const source = createTokenSource({ config: cfg(), fetchFn, now: () => T0 })
    const [a, b] = await Promise.all([source.getToken(), source.getToken()])
    expect(a).toBe(token)
    expect(b).toBe(token)
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('refreshes when the cached token enters the 60s expiry margin', async () => {
    let t = T0
    const token1 = jwtWithExp((T0 + 500_000) / 1000)
    const token2 = jwtWithExp((T0 + 900_000) / 1000)
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ token: token1 }))
      .mockResolvedValueOnce(jsonResponse({ token: token2 }))
    const source = createTokenSource({ config: cfg(), fetchFn, now: () => t })

    await expect(source.getToken()).resolves.toBe(token1)
    // Simulate time passing: beyond refreshAt (exp - 60s) but before exp.
    t = T0 + 441_000
    await expect(source.getToken()).resolves.toBe(token2)
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })

  it('refetches after explicit invalidate()', async () => {
    const token1 = jwtWithExp((T0 + 3_600_000) / 1000)
    const token2 = jwtWithExp((T0 + 7_200_000) / 1000)
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ token: token1 }))
      .mockResolvedValueOnce(jsonResponse({ token: token2 }))
    const source = createTokenSource({ config: cfg(), fetchFn, now: () => T0 })
    await source.getToken()
    source.invalidate()
    await expect(source.getToken()).resolves.toBe(token2)
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })

  it('maps HTTP errors to a typed, opaque message (status only)', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ token: 'secret-material' }, 503))
    const source = createTokenSource({ config: cfg(), fetchFn, now: () => T0 })
    const err = await source.getToken().catch((e: unknown) => e)
    expect(err).toBeInstanceOf(TokenError)
    expect((err as TokenError).code).toBe('service-error')
    expect((err as TokenError).message).toContain('503')
    expect((err as TokenError).message).not.toContain('secret-material')
    // Failed fetches are not cached: the next call retries.
    await expect(source.getToken()).rejects.toMatchObject({ code: 'service-error' })
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })

  it('maps network failures to a typed error', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error('ECONNREFUSED https://tokens.example/jwt?apikey=shhh'))
    const source = createTokenSource({ config: cfg(), fetchFn, now: () => T0 })
    const err = await source.getToken().catch((e: unknown) => e)
    expect((err as TokenError).code).toBe('network')
    expect((err as TokenError).message).not.toContain('shhh')
  })

  it('rejects malformed JSON bodies', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('Unexpected token <')
      },
    } as unknown as Response)
    const source = createTokenSource({ config: cfg(), fetchFn, now: () => T0 })
    await expect(source.getToken()).rejects.toMatchObject({ code: 'invalid-response' })
  })

  it('rejects bodies without a token or with a non-string token', async () => {
    for (const body of [{}, { token: 12345 }, { access_token: 'x' }, { token: '' }]) {
      const fetchFn = vi.fn().mockResolvedValue(jsonResponse(body))
      const source = createTokenSource({ config: cfg(), fetchFn, now: () => T0 })
      const err = await source.getToken().catch((e: unknown) => e)
      expect((err as TokenError).code, JSON.stringify(body)).toBe('invalid-response')
      expect((err as TokenError).message).not.toContain('12345')
    }
  })

  it('rejects malformed token values without echoing them', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ token: 'totally-broken' }))
    const source = createTokenSource({ config: cfg(), fetchFn, now: () => T0 })
    const err = await source.getToken().catch((e: unknown) => e)
    expect((err as TokenError).code).toBe('invalid-response')
    expect((err as TokenError).message).not.toContain('totally-broken')
  })

  it('rejects an expired token from the service and never caches it', async () => {
    const expired = jwtWithExp((T0 - 5_000) / 1000)
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ token: expired }))
    const source = createTokenSource({ config: cfg(), fetchFn, now: () => T0 })
    const err = await source.getToken().catch((e: unknown) => e)
    expect((err as TokenError).code).toBe('expired-token')
    expect((err as TokenError).message).not.toContain(expired)
    await expect(source.getToken()).rejects.toMatchObject({ code: 'expired-token' })
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })

  it('accepts a valid token without a readable exp (short fallback TTL)', async () => {
    const token = `${b64url('{"alg":"ES256"}')}.${b64url('{"iss":"T"}')}.c2ln`
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ token }))
    const source = createTokenSource({ config: cfg(), fetchFn, now: () => T0 })
    await expect(source.getToken()).resolves.toBe(token)
    await expect(source.getToken()).resolves.toBe(token)
    expect(fetchFn).toHaveBeenCalledTimes(1) // cached under the 5-minute fallback TTL
  })

  it('accepts the { developerToken } response alias', async () => {
    const token = jwtWithExp((T0 + 3_600_000) / 1000)
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ developerToken: token }))
    const source = createTokenSource({ config: cfg(), fetchFn, now: () => T0 })
    await expect(source.getToken()).resolves.toBe(token)
  })
})

describe('createTokenSource — static local-dev token', () => {
  it('returns a valid static token without any fetch', async () => {
    const token = jwtWithExp((T0 + 3_600_000) / 1000)
    const fetchFn = vi.fn()
    const source = createTokenSource({
      config: cfg({ tokenUrl: '', staticToken: token }),
      fetchFn,
      now: () => T0,
    })
    expect(source.isDynamic).toBe(false)
    await expect(source.getToken()).resolves.toBe(token)
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('rejects an expired static token', async () => {
    const token = jwtWithExp((T0 - 60_000) / 1000)
    const source = createTokenSource({
      config: cfg({ tokenUrl: '', staticToken: token }),
      now: () => T0,
    })
    await expect(source.getToken()).rejects.toMatchObject({ code: 'expired-token' })
  })

  it('rejects a malformed static token without echoing it', async () => {
    const source = createTokenSource({
      config: cfg({ tokenUrl: '', staticToken: 'garbage-value' }),
      now: () => T0,
    })
    const err = await source.getToken().catch((e: unknown) => e)
    expect((err as TokenError).code).toBe('invalid-response')
    expect((err as TokenError).message).not.toContain('garbage-value')
  })
})
