/**
 * Audius REST client — thin typed fetch wrapper over https://api.audius.co/v1.
 *
 * Transport choice: the official @audius/sdk sends its API key as an
 * `api_key` query parameter from the browser; we do the same over plain
 * fetch, keeping this bundle dependency-free while matching the SDK's
 * transport exactly. Anonymous access works (api_key optional).
 *
 * Free-plan discipline (docs.audius.co — 10 req/s, 500k req/month):
 * - minimum gap between request starts (default 130ms ≈ 7.7 req/s)
 * - small TTL cache so repeated view renders don't refetch
 * - one capped retry on 429, then a typed `rate-limited` error
 * - per-request timeout (default 8s), typed error codes for the facade
 *
 * The Bearer/user token flow is backend-only and intentionally absent here.
 */

export type AudiusErrorCode =
  | 'network'
  | 'timeout'
  | 'http'
  | 'rate-limited'
  | 'malformed'
  | 'not-found'

export class AudiusError extends Error {
  readonly code: AudiusErrorCode
  readonly status?: number

  constructor(code: AudiusErrorCode, message: string, status?: number) {
    super(message)
    this.name = 'AudiusError'
    this.code = code
    this.status = status
  }
}

export interface AudiusArtwork {
  '150x150'?: string
  '480x480'?: string
  '1000x1000'?: string
  '_150x150'?: string
  '_480x480'?: string
  '_1000x1000'?: string
  mirrors?: string[]
}

export interface AudiusRawUser {
  id: string
  name?: string
  handle?: string
  bio?: string
  track_count?: number
  profile_picture?: AudiusArtwork | null
  profile_pic?: AudiusArtwork | null
}

export interface AudiusRawTrack {
  id: string
  title?: string
  duration?: number
  artwork?: AudiusArtwork | null
  user?: AudiusRawUser | null
  genre?: string
  release_date?: string
  is_delete?: boolean
  is_unlisted?: boolean
  is_streamable?: boolean
  is_stream_gated?: boolean
  stream_conditions?: unknown
  play_count?: number
}

export interface AudiusRawPlaylistEntry {
  track_id: string
  timestamp?: number
}

export interface AudiusRawPlaylist {
  id: string
  playlist_name?: string
  title?: string
  description?: string
  artwork?: AudiusArtwork | null
  cover_art?: AudiusArtwork | null
  user?: AudiusRawUser | null
  user_id?: string
  is_album?: boolean
  playlist_contents?: AudiusRawPlaylistEntry[]
  tracks?: AudiusRawTrack[]
  created_at?: string
  release_date?: string
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export interface AudiusClientOptions {
  baseUrl?: string
  apiKey?: string
  fetchFn?: FetchLike
  now?: () => number
  sleep?: (ms: number) => Promise<void>
  /** Minimum milliseconds between request starts. */
  minGapMs?: number
  timeoutMs?: number
  /** Max cached URLs (FIFO eviction). */
  cacheMax?: number
}

interface CacheEntry {
  body: unknown
  expiresAt: number
}

const DEFAULTS = {
  baseUrl: 'https://api.audius.co/v1',
  minGapMs: 130,
  timeoutMs: 8_000,
  cacheMax: 160,
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isAbort(err: unknown): boolean {
  return err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')
}

export class AudiusClient {
  private readonly baseUrl: string
  private readonly apiKey: string
  private readonly fetchFn: FetchLike
  private readonly now: () => number
  private readonly sleep: (ms: number) => Promise<void>
  private readonly minGapMs: number
  private readonly timeoutMs: number
  private readonly cacheMax: number
  private readonly cache = new Map<string, CacheEntry>()
  private lastStartedAt = 0

  constructor(options: AudiusClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? DEFAULTS.baseUrl).replace(/\/$/, '')
    this.apiKey = (options.apiKey ?? '').trim()
    const globalFetch = (globalThis.fetch as FetchLike | undefined)?.bind(globalThis)
    if (!options.fetchFn && !globalFetch) {
      throw new AudiusError('network', 'No fetch implementation available')
    }
    this.fetchFn = options.fetchFn ?? (globalFetch as FetchLike)
    this.now = options.now ?? Date.now
    this.sleep = options.sleep ?? defaultSleep
    this.minGapMs = options.minGapMs ?? DEFAULTS.minGapMs
    this.timeoutMs = options.timeoutMs ?? DEFAULTS.timeoutMs
    this.cacheMax = options.cacheMax ?? DEFAULTS.cacheMax
  }

  clearCache(): void {
    this.cache.clear()
  }

  buildUrl(path: string, params: Record<string, string | number | undefined> = {}): string {
    const search = new URLSearchParams()
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === '') continue
      search.set(key, String(value))
    }
    if (this.apiKey) search.set('api_key', this.apiKey)
    const qs = search.toString()
    return qs ? `${this.baseUrl}${path}?${qs}` : `${this.baseUrl}${path}`
  }

  /**
   * GET with TTL cache, start-gap throttling, timeout, one 429 retry.
   * Returns the parsed JSON body; shape validation belongs to the callers.
   */
  async request<T>(path: string, params: Record<string, string | number | undefined> = {}, ttlMs = 60_000): Promise<T> {
    const url = this.buildUrl(path, params)
    const hit = this.cache.get(url)
    if (hit && hit.expiresAt > this.now()) return hit.body as T

    const body = await this.fetchJson(url)

    if (this.cache.size >= this.cacheMax) {
      const oldest = this.cache.keys().next().value
      if (oldest !== undefined) this.cache.delete(oldest)
    }
    this.cache.set(url, { body, expiresAt: this.now() + ttlMs })
    return body as T
  }

  private async fetchJson(url: string): Promise<unknown> {
    let attempt = 0
    for (;;) {
      await this.throttle()
      this.lastStartedAt = this.now()
      let res: Response
      try {
        res = await this.fetchFn(url, {
          headers: { Accept: 'application/json' },
          signal: this.makeSignal(),
        })
      } catch (err) {
        if (isAbort(err)) throw new AudiusError('timeout', 'Audius request timed out')
        throw new AudiusError('network', err instanceof Error ? err.message : 'Audius request failed')
      }

      if (res.status === 429) {
        if (attempt === 0) {
          attempt += 1
          await this.sleep(this.retryAfterMs(res))
          continue
        }
        throw new AudiusError('rate-limited', 'Audius rate limit (free plan: 10 req/s)', 429)
      }
      if (res.status === 404) throw new AudiusError('not-found', 'Audius resource not found', 404)
      if (!res.ok) throw new AudiusError('http', `Audius HTTP ${res.status}`, res.status)

      try {
        return await res.json()
      } catch {
        throw new AudiusError('malformed', 'Audius returned invalid JSON', res.status)
      }
    }
  }

  private async throttle(): Promise<void> {
    const wait = this.minGapMs - (this.now() - this.lastStartedAt)
    if (wait > 0) await this.sleep(wait)
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

  // — Response unwrapping (Audius wraps payloads as { data: T | T[] }) ————————

  private async list<T>(path: string, params: Record<string, string | number | undefined> = {}, ttlMs?: number): Promise<T[]> {
    const body = await this.request<unknown>(path, params, ttlMs)
    const data = (body as { data?: unknown } | null)?.data ?? body
    if (Array.isArray(data)) return data as T[]
    if (data && typeof data === 'object') return [data as T]
    return []
  }

  private async one<T>(path: string, params: Record<string, string | number | undefined> = {}, ttlMs?: number): Promise<T | null> {
    const body = await this.request<unknown>(path, params, ttlMs)
    const data = (body as { data?: unknown } | null)?.data ?? body
    if (Array.isArray(data)) return (data[0] as T | undefined) ?? null
    if (data && typeof data === 'object') return data as T
    return null
  }

  // — Endpoints (public, read-only; see api.audius.co/v1/swagger.yaml) ———————

  searchTracks(query: string, limit = 20, offset = 0, ttlMs?: number): Promise<AudiusRawTrack[]> {
    return this.list<AudiusRawTrack>('/tracks/search', { query, limit, offset }, ttlMs)
  }

  trendingTracks(limit = 20, opts: { genre?: string; time?: 'week' | 'month' | 'year'; ttlMs?: number } = {}): Promise<AudiusRawTrack[]> {
    return this.list<AudiusRawTrack>('/tracks/trending', { limit, genre: opts.genre, time: opts.time }, opts.ttlMs)
  }

  undergroundTracks(limit = 20, ttlMs?: number): Promise<AudiusRawTrack[]> {
    return this.list<AudiusRawTrack>('/tracks/trending/underground', { limit }, ttlMs)
  }

  getTrack(id: string, ttlMs?: number): Promise<AudiusRawTrack | null> {
    return this.one<AudiusRawTrack>(`/tracks/${encodeURIComponent(id)}`, {}, ttlMs)
  }

  getUser(id: string, ttlMs?: number): Promise<AudiusRawUser | null> {
    return this.one<AudiusRawUser>(`/users/${encodeURIComponent(id)}`, {}, ttlMs)
  }

  searchUsers(query: string, limit = 8, ttlMs?: number): Promise<AudiusRawUser[]> {
    return this.list<AudiusRawUser>('/users/search', { query, limit }, ttlMs)
  }

  userTracks(userId: string, limit = 8, ttlMs?: number): Promise<AudiusRawTrack[]> {
    return this.list<AudiusRawTrack>(`/users/${encodeURIComponent(userId)}/tracks`, { limit }, ttlMs)
  }

  userAlbums(userId: string, limit = 8, ttlMs?: number): Promise<AudiusRawPlaylist[]> {
    return this.list<AudiusRawPlaylist>(`/users/${encodeURIComponent(userId)}/albums`, { limit }, ttlMs)
  }

  searchPlaylists(query: string, limit = 8, ttlMs?: number): Promise<AudiusRawPlaylist[]> {
    return this.list<AudiusRawPlaylist>('/playlists/search', { query, limit }, ttlMs)
  }

  trendingPlaylists(limit = 8, ttlMs?: number): Promise<AudiusRawPlaylist[]> {
    return this.list<AudiusRawPlaylist>('/playlists/trending', { limit }, ttlMs)
  }

  getPlaylist(id: string, ttlMs?: number): Promise<AudiusRawPlaylist | null> {
    return this.one<AudiusRawPlaylist>(`/playlists/${encodeURIComponent(id)}`, {}, ttlMs)
  }

  /**
   * Streaming URL for an <audio> element. The endpoint 302-redirects to a
   * signed CDN address; browsers follow redirects and honour Range requests,
   * so the existing player engine needs no changes. Never fetched here.
   */
  streamUrl(trackId: string): string {
    return this.buildUrl(`/tracks/${encodeURIComponent(trackId)}/stream`)
  }

  /**
   * Pre-populate the per-track cache from embedded playlist tracks so a
   * playlist detail view can resolve all its songs without extra requests.
   */
  warmTrackCache(tracks: AudiusRawTrack[], ttlMs = 5 * 60_000): void {
    for (const track of tracks) {
      if (!track?.id) continue
      const url = this.buildUrl(`/tracks/${encodeURIComponent(track.id)}`)
      this.cache.set(url, { body: { data: track }, expiresAt: this.now() + ttlMs })
    }
  }
}
