/**
 * MusicKit developer-token acquisition (milestone M1 — token plumbing).
 *
 * The .p8 private key NEVER reaches this repository or the browser bundle.
 * Tokens come from one of two public-config sources:
 *
 *   1. VITE_MUSICKIT_TOKEN_URL — a token-signing service (separate private
 *      service holding the .p8) returning JSON: { "token": "<ES256 JWT>" }.
 *      Recommended: the optional `origin` claim is asserted by that service
 *      (Apple: "Generating Developer Tokens" — origin claim is recommended
 *      for web clients; the browser cannot sign, so this repo never does).
 *   2. VITE_MUSICKIT_DEVELOPER_TOKEN — a pre-signed token for local
 *      development only (git-ignored .env).
 *
 * Activation gate (explicit two-key gate, musickit-milestone.md §5/§7):
 *   VITE_MUSICKIT_ENABLED  AND  (valid VITE_MUSICKIT_TOKEN_URL | static token)
 * When the gate fails, callers must make no MusicKit request at all.
 *
 * Errors are typed (`TokenError`) with messages that never contain token
 * material, response bodies, or sensitive headers. Token material is only
 * ever passed to MusicKit.configure(), never logged.
 */

export interface MusicKitConfig {
  enabled: boolean
  tokenUrl: string
  staticToken: string
}

export type TokenErrorCode =
  | 'not-configured'
  | 'invalid-url'
  | 'network'
  | 'service-error'
  | 'invalid-response'
  | 'expired-token'

export class TokenError extends Error {
  readonly code: TokenErrorCode

  constructor(code: TokenErrorCode, message: string) {
    super(message)
    this.name = 'TokenError'
    this.code = code
  }
}

/** Read a raw env shape (pure — unit-testable without import.meta.env). */
export function parseMusicKitConfig(raw: {
  enabled?: string
  tokenUrl?: string
  staticToken?: string
}): MusicKitConfig {
  const enabled = /^(1|true|yes|on)$/i.test((raw.enabled ?? '').trim())
  return {
    enabled,
    tokenUrl: (raw.tokenUrl ?? '').trim(),
    staticToken: (raw.staticToken ?? '').trim(),
  }
}

/** Literal import.meta.env reads so Vite bakes values at build time. */
export function readMusicKitConfig(): MusicKitConfig {
  return parseMusicKitConfig({
    enabled: import.meta.env.VITE_MUSICKIT_ENABLED as string | undefined,
    tokenUrl: import.meta.env.VITE_MUSICKIT_TOKEN_URL as string | undefined,
    staticToken: import.meta.env.VITE_MUSICKIT_DEVELOPER_TOKEN as string | undefined,
  })
}

/** Only plain http(s) endpoints are acceptable as a token service. */
export function isValidServiceUrl(url: string): boolean {
  if (!url) return false
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:'
  } catch {
    return false
  }
}

/** Runtime token-service URL when enabled and valid; otherwise null. */
export function serviceUrlOf(config: MusicKitConfig): string | null {
  if (!config.enabled || !config.tokenUrl) return null
  return isValidServiceUrl(config.tokenUrl) ? config.tokenUrl : null
}

/** Static local-dev token when enabled and no (valid) service URL is set. */
export function staticTokenOf(config: MusicKitConfig): string | null {
  if (!config.enabled || serviceUrlOf(config)) return null
  return config.staticToken.length > 0 ? config.staticToken : null
}

/** Two-key gate: explicit flag AND a usable token source. */
export function isMusicKitConfigured(config: MusicKitConfig = readMusicKitConfig()): boolean {
  if (!config.enabled) return false
  if (config.tokenUrl && !isValidServiceUrl(config.tokenUrl)) return false
  return serviceUrlOf(config) !== null || staticTokenOf(config) !== null
}

/** Human-readable status for the Settings dialog (never includes tokens). */
export function describeMusicKitConfig(config: MusicKitConfig): string {
  if (!config.enabled) {
    return 'Not enabled. Set VITE_MUSICKIT_ENABLED=1 and a token source to activate.'
  }
  if (config.tokenUrl && !isValidServiceUrl(config.tokenUrl)) {
    return 'Not configured: VITE_MUSICKIT_TOKEN_URL must be an http(s) URL.'
  }
  if (serviceUrlOf(config)) {
    return 'Token service configured (VITE_MUSICKIT_TOKEN_URL); a developer token is requested at runtime. ' +
      'Streaming still requires user authorization and an Apple Music subscription.'
  }
  if (staticTokenOf(config)) {
    return 'Static developer token present (local development only). ' +
      'Streaming still requires user authorization and an Apple Music subscription.'
  }
  return 'Not configured: set VITE_MUSICKIT_TOKEN_URL (or VITE_MUSICKIT_DEVELOPER_TOKEN for local development).'
}

/** JWT-shaped check: three non-empty base64url segments. */
export function isJwtShaped(token: string): boolean {
  const parts = token.split('.')
  return parts.length === 3 && parts.every((p) => p.length > 0)
}

/** Best-effort `exp` (epoch seconds) from a JWT payload; null if unreadable. */
export function decodeJwtExpSec(token: string): number | null {
  if (!isJwtShaped(token)) return null
  const payload = token.split('.')[1]
  if (!payload) return null
  try {
    const b64 = payload.replace(/-/g, '+').replace(/_/g, '/')
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
    const data = JSON.parse(atob(padded)) as { exp?: unknown }
    if (typeof data.exp === 'number' && Number.isFinite(data.exp)) return Math.floor(data.exp)
    return null
  } catch {
    return null
  }
}

export interface TokenSource {
  /** True when tokens come from a (refreshable) token service URL. */
  readonly isDynamic: boolean
  /** Returns a valid token, fetching/refreshing as needed. Never logs it. */
  getToken(): Promise<string>
  /** Drops any cached token so the next getToken() fetches a fresh one. */
  invalidate(): void
}

export interface TokenSourceOptions {
  config?: MusicKitConfig
  fetchFn?: typeof fetch
  now?: () => number
}

/** Refresh margin: refetch when a token is within 60s of its `exp`. */
const REFRESH_MARGIN_MS = 60_000
/** Fallback cache TTL when the service returns a token without a readable `exp`. */
const FALLBACK_TTL_MS = 5 * 60_000
const FETCH_TIMEOUT_MS = 8_000

function timeoutSignal(): AbortSignal | undefined {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(FETCH_TIMEOUT_MS)
  }
  return undefined
}

export function createTokenSource(opts: TokenSourceOptions = {}): TokenSource {
  const config = opts.config ?? readMusicKitConfig()
  const fetchFn: typeof fetch = opts.fetchFn ?? ((...args) => globalThis.fetch(...args))
  const now = opts.now ?? (() => Date.now())

  if (!isMusicKitConfigured(config)) {
    return {
      isDynamic: false,
      getToken: () => Promise.reject(new TokenError('not-configured', 'MusicKit token source is not configured.')),
      invalidate: () => {},
    }
  }

  const url = serviceUrlOf(config)

  if (!url) {
    // Static local-dev token: no refresh possible; validate shape + expiry.
    const staticToken = staticTokenOf(config) ?? ''
    return {
      isDynamic: false,
      getToken: async () => {
        if (!isJwtShaped(staticToken)) {
          throw new TokenError('invalid-response', 'Configured developer token is malformed.')
        }
        const expSec = decodeJwtExpSec(staticToken)
        if (expSec !== null && expSec * 1000 <= now()) {
          throw new TokenError('expired-token', 'Configured developer token is expired.')
        }
        return staticToken
      },
      invalidate: () => {},
    }
  }

  let cached: { token: string; refreshAtMs: number } | null = null
  let pending: Promise<string> | null = null
  const tokenUrl: string = url // narrowed for closures

  async function request(): Promise<string> {
    let res: Response
    try {
      const signal = timeoutSignal()
      res = await fetchFn(tokenUrl, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        ...(signal ? { signal } : {}),
      })
    } catch {
      // Deliberately opaque: no URL query, headers, or token material.
      throw new TokenError('network', 'Token service request failed.')
    }
    if (!res.ok) {
      // Status only — never the body, which could echo token material.
      throw new TokenError('service-error', `Token service responded with status ${res.status}.`)
    }
    let body: unknown
    try {
      body = await res.json()
    } catch {
      throw new TokenError('invalid-response', 'Token service returned malformed JSON.')
    }
    const rec = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>
    const raw = typeof rec['token'] === 'string' ? rec['token'] : typeof rec['developerToken'] === 'string' ? rec['developerToken'] : ''
    if (!raw) {
      throw new TokenError('invalid-response', 'Token service response is missing a token.')
    }
    if (!isJwtShaped(raw)) {
      // Never echo the malformed value.
      throw new TokenError('invalid-response', 'Token service returned a malformed token.')
    }
    const expMs = decodeJwtExpSec(raw)
    if (expMs !== null && expMs * 1000 <= now()) {
      throw new TokenError('expired-token', 'Token service returned an expired token.')
    }
    const expiresAtMs = expMs !== null ? expMs * 1000 : now() + FALLBACK_TTL_MS
    cached = { token: raw, refreshAtMs: expiresAtMs - REFRESH_MARGIN_MS }
    return raw
  }

  return {
    isDynamic: true,
    getToken(): Promise<string> {
      if (cached && now() < cached.refreshAtMs) return Promise.resolve(cached.token)
      if (!pending) {
        pending = request().finally(() => {
          pending = null
        })
      }
      return pending
    },
    invalidate(): void {
      cached = null
    },
  }
}
