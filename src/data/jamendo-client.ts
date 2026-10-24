/**
 * Jamendo REST client — thin typed fetch wrapper over https://api.jamendo.com/v3.0.
 *
 * Transport (docs: developer.jamendo.com/v3.0):
 * - every read method is a GET with `client_id` + `format=json`
 * - responses wrap results as { headers: { status, code, error_message,
 *   results_count }, results: [...] } — `headers.status !== 'success'` is a
 *   typed API error even when HTTP is 200
 * - tracks default to albumtracks only, so `type=single albumtrack` is always
 *   sent (singles must not disappear from search)
 *
 * Discipline: no documented rate limit, so behaviour is a small TTL cache
 * (search 60s / entities 5 min) + an 8s per-request timeout + one capped
 * retry on 429/5xx with Retry-After, then a typed error for the facade.
 * A client constructed without a `client_id` refuses every request up front
 * (code `unconfigured`) — an unconfigured provider never issues a call.
 */

export type JamendoErrorCode =
  | 'network'
  | 'timeout'
  | 'http'
  | 'malformed'
  | 'api'
  | 'rate-limited'
  | 'unconfigured'

export class JamendoError extends Error {
  readonly code: JamendoErrorCode
  readonly status?: number

  constructor(code: JamendoErrorCode, message: string, status?: number) {
    super(message)
    this.name = 'JamendoError'
    this.code = code
    this.status = status
  }
}

export interface JamendoHeaders {
  status?: string
  code?: number
  error_message?: string
  results_count?: number
}

export interface JamendoEnvelope<T> {
  headers?: JamendoHeaders
  results?: T[]
}

export interface JamendoRawMusicInfo {
  /** Lyrics language stated by the track's metadata (ISO 639-1, may be ""). */
  lang?: string
}

export interface JamendoRawTrack {
  id?: string
  name?: string
  duration?: number
  artist_id?: string
  artist_name?: string
  artist_idstr?: string
  album_id?: string
  album_name?: string
  album_image?: string
  image?: string
  audio?: string
  audiodownload?: string
  audiodownload_allowed?: boolean
  license_ccurl?: string
  releasedate?: string
  shareurl?: string
  shorturl?: string
  position?: number
  /** Present when `include` asks for `musicinfo` (documented sample field). */
  musicinfo?: JamendoRawMusicInfo
}

export interface JamendoRawAlbum {
  id?: string
  name?: string
  releasedate?: string
  artist_id?: string
  artist_name?: string
  image?: string
  shareurl?: string
  shorturl?: string
}

export interface JamendoRawArtist {
  id?: string
  name?: string
  website?: string
  joindate?: string
  image?: string
  shareurl?: string
  shorturl?: string
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export interface JamendoClientOptions {
  baseUrl?: string
  clientId?: string
  fetchFn?: FetchLike
  now?: () => number
  sleep?: (ms: number) => Promise<void>
  timeoutMs?: number
  /** Max cached URLs (FIFO eviction). */
  cacheMax?: number
}

interface CacheEntry {
  body: unknown
  expiresAt: number
}

const DEFAULTS = {
  baseUrl: 'https://api.jamendo.com/v3.0',
  timeoutMs: 8_000,
  cacheMax: 120,
}

/** Params every tracks call needs (singles included, mp3 stream, licences). */
const TRACK_DEFAULTS = {
  format: 'json',
  type: 'single albumtrack',
  audioformat: 'mp32',
  imagesize: '600',
  // Space-separated array values (the documented `type=single albumtrack`
  // pattern): licences for attribution + musicinfo for the track's language.
  include: 'licenses musicinfo',
} as const

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isAbort(err: unknown): boolean {
  return err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')
}

export class JamendoClient {
  private readonly baseUrl: string
  private readonly clientId: string
  private readonly fetchFn: FetchLike
  private readonly now: () => number
  private readonly sleep: (ms: number) => Promise<void>
  private readonly timeoutMs: number
  private readonly cacheMax: number
  private readonly cache = new Map<string, CacheEntry>()

  constructor(options: JamendoClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? DEFAULTS.baseUrl).replace(/\/$/, '')
    this.clientId = (options.clientId ?? '').trim()
    const globalFetch = (globalThis.fetch as FetchLike | undefined)?.bind(globalThis)
    if (!options.fetchFn && !globalFetch) {
      throw new JamendoError('network', 'No fetch implementation available')
    }
    this.fetchFn = options.fetchFn ?? (globalFetch as FetchLike)
    this.now = options.now ?? Date.now
    this.sleep = options.sleep ?? defaultSleep
    this.timeoutMs = options.timeoutMs ?? DEFAULTS.timeoutMs
    this.cacheMax = options.cacheMax ?? DEFAULTS.cacheMax
  }

  clearCache(): void {
    this.cache.clear()
  }

  buildUrl(path: string, params: Record<string, string | number | undefined> = {}): string {
    const search = new URLSearchParams()
    search.set('client_id', this.clientId)
    search.set('format', 'json')
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === '') continue
      search.set(key, String(value))
    }
    const qs = search.toString()
    return `${this.baseUrl}${path}?${qs}`
  }

  /** GET with TTL cache; returns the validated envelope (typed on failure). */
  async request<T>(path: string, params: Record<string, string | number | undefined> = {}, ttlMs = 60_000): Promise<JamendoEnvelope<T>> {
    if (!this.clientId) {
      // Config gate: no client id → no request, typed error for the facade.
      throw new JamendoError('unconfigured', 'Jamendo client id missing (set VITE_JAMENDO_CLIENT_ID)')
    }
    const url = this.buildUrl(path, params)
    const hit = this.cache.get(url)
    if (hit && hit.expiresAt > this.now()) return hit.body as JamendoEnvelope<T>

    const body = await this.fetchJson(url)

    if (this.cache.size >= this.cacheMax) {
      const oldest = this.cache.keys().next().value
      if (oldest !== undefined) this.cache.delete(oldest)
    }
    this.cache.set(url, { body, expiresAt: this.now() + ttlMs })
    return body as JamendoEnvelope<T>
  }

  private async fetchJson(url: string): Promise<unknown> {
    let attempt = 0
    for (;;) {
      let res: Response
      try {
        res = await this.fetchFn(url, {
          headers: { Accept: 'application/json' },
          signal: this.makeSignal(),
        })
      } catch (err) {
        if (isAbort(err)) throw new JamendoError('timeout', 'Jamendo request timed out')
        throw new JamendoError('network', err instanceof Error ? err.message : 'Jamendo request failed')
      }

      let parsed: unknown = null
      let parseFailed = false
      try {
        parsed = await res.json()
      } catch {
        parseFailed = true
      }

      if (!res.ok) {
        // Jamendo reports API failures (bad client id, bad params) as JSON
        // envelopes — surface the documented error_message when present.
        const env = parsed as JamendoEnvelope<unknown> | null
        const msg = env?.headers?.error_message
        if (msg) throw new JamendoError('api', msg, res.status)
        if (res.status === 429 && attempt === 0) {
          attempt += 1
          await this.sleep(this.retryAfterMs(res))
          continue
        }
        if (res.status === 429) throw new JamendoError('rate-limited', 'Jamendo rate limit hit', 429)
        throw new JamendoError('http', `Jamendo HTTP ${res.status}`, res.status)
      }
      if (parseFailed || parsed === null || typeof parsed !== 'object') {
        throw new JamendoError('malformed', 'Jamendo returned invalid JSON', res.status)
      }

      const env = parsed as JamendoEnvelope<unknown>
      if (env.headers && env.headers.status && env.headers.status !== 'success') {
        const msg = env.headers.error_message || `Jamendo API error (code ${env.headers.code ?? '?'})`
        throw new JamendoError('api', msg, res.status)
      }
      return parsed
    }
  }

  private retryAfterMs(res: Response): number {
    const raw = Number(res.headers?.get?.('Retry-After') ?? '')
    const ms = Number.isFinite(raw) && raw > 0 ? raw * 1000 : 600
    return Math.min(ms, 2_000)
  }

  private makeSignal(): AbortSignal | undefined {
    if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
      return AbortSignal.timeout(this.timeoutMs)
    }
    return undefined
  }

  private async results<T>(path: string, params: Record<string, string | number | undefined>, ttlMs?: number): Promise<T[]> {
    const env = await this.request<T>(path, params, ttlMs)
    return Array.isArray(env.results) ? env.results : []
  }

  // — Read methods (developer.jamendo.com/v3.0/tracks | /albums | /artists) ——

  /** Search/browse tracks. `language` maps to `lang` (2-letter lyrics code). */
  searchTracks(opts: {
    query?: string
    language?: string
    limit?: number
    offset?: number
    albumId?: string
    artistId?: string
    id?: string
    ttlMs?: number
  }): Promise<JamendoRawTrack[]> {
    const params: Record<string, string | number | undefined> = {
      ...TRACK_DEFAULTS,
      limit: opts.limit ?? 10,
      offset: opts.offset ?? 0,
      search: opts.query,
      lang: opts.language,
      album_id: opts.albumId,
      artist_id: opts.artistId,
      id: opts.id,
    }
    // Relevance is only meaningful (and required) alongside a text search.
    if (opts.query) params['order'] = 'relevance'
    return this.results<JamendoRawTrack>('/tracks', params, opts.ttlMs ?? 60_000)
  }

  getAlbum(id: string, ttlMs?: number): Promise<JamendoRawAlbum[]> {
    return this.results<JamendoRawAlbum>('/albums', { format: 'json', id, limit: 1 }, ttlMs ?? 5 * 60_000)
  }

  albumsByArtist(artistId: string, limit = 12, ttlMs?: number): Promise<JamendoRawAlbum[]> {
    return this.results<JamendoRawAlbum>(
      '/albums',
      { format: 'json', artist_id: artistId, limit, imagesize: 600 },
      ttlMs ?? 5 * 60_000,
    )
  }

  getArtist(id: string, ttlMs?: number): Promise<JamendoRawArtist[]> {
    return this.results<JamendoRawArtist>('/artists', { format: 'json', id, limit: 1 }, ttlMs ?? 5 * 60_000)
  }
}
