/**
 * YouTube Data API v3 client — thin typed fetch wrapper (search + videos).
 *
 * Docs: developers.google.com/youtube/v3/docs/search/list (+ videos/list).
 * - `search.list` requires part=snippet; we pin type=video +
 *   videoEmbeddable=true so every result can legally be embedded, and pass
 *   relevanceLanguage when a language filter is selected.
 * - Quota: Google's default allocation is 100 search.list calls/day (other
 *   endpoints 10,000 units/day), so the client sends maxResults=10 and adds
 *   one cheap videos.list call (1 unit) per search only to fill durations.
 * - Key travels as the documented `key` query parameter (browser-side use
 *   with a referrer-restricted key — see youtube-config.ts).
 *
 * Errors arrive as { error: { code, message, errors[] } } and are mapped to a
 * typed YoutubeError for the facade's per-group isolation.
 */

export type YoutubeErrorCode = 'network' | 'timeout' | 'http' | 'malformed' | 'quota' | 'forbidden' | 'api'

export class YoutubeError extends Error {
  readonly code: YoutubeErrorCode
  readonly status?: number

  constructor(code: YoutubeErrorCode, message: string, status?: number) {
    super(message)
    this.name = 'YoutubeError'
    this.code = code
    this.status = status
  }
}

export interface YoutubeThumbnail {
  url?: string
  width?: number
  height?: number
}

export interface YoutubeSnippet {
  title?: string
  description?: string
  channelTitle?: string
  channelId?: string
  publishedAt?: string
  liveBroadcastContent?: string
  thumbnails?: {
    default?: YoutubeThumbnail
    medium?: YoutubeThumbnail
    high?: YoutubeThumbnail
    standard?: YoutubeThumbnail
    maxres?: YoutubeThumbnail
  }
}

export interface YoutubeSearchItem {
  id?: { kind?: string; videoId?: string }
  snippet?: YoutubeSnippet
}

export interface YoutubeSearchResponse {
  kind?: string
  nextPageToken?: string
  prevPageToken?: string
  pageInfo?: { totalResults?: number; resultsPerPage?: number }
  items?: YoutubeSearchItem[]
  error?: YoutubeApiError
}

export interface YoutubeVideoItem {
  id?: string
  snippet?: YoutubeSnippet
  contentDetails?: { duration?: string }
  /** `status.madeForKids` — required lookup for made-for-kids handling (III.E.4.j). */
  status?: { madeForKids?: boolean; selfDeclaredMadeForKids?: boolean }
}

export interface YoutubeVideosResponse {
  items?: YoutubeVideoItem[]
  error?: YoutubeApiError
}

export interface YoutubeChannelItem {
  id?: string
  snippet?: YoutubeSnippet
}

export interface YoutubeChannelsResponse {
  items?: YoutubeChannelItem[]
  error?: YoutubeApiError
}

interface YoutubeApiError {
  code?: number
  message?: string
  errors?: Array<{ reason?: string; message?: string }>
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export interface YoutubeClientOptions {
  baseUrl?: string
  apiKey?: string
  fetchFn?: FetchLike
  now?: () => number
  timeoutMs?: number
  cacheMax?: number
}

interface CacheEntry {
  body: unknown
  expiresAt: number
}

const DEFAULTS = {
  baseUrl: 'https://www.googleapis.com/youtube/v3',
  timeoutMs: 8_000,
  cacheMax: 120,
}

function isAbort(err: unknown): boolean {
  return err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')
}

export class YoutubeClient {
  private readonly baseUrl: string
  private readonly apiKey: string
  private readonly fetchFn: FetchLike
  private readonly now: () => number
  private readonly timeoutMs: number
  private readonly cacheMax: number
  private readonly cache = new Map<string, CacheEntry>()

  constructor(options: YoutubeClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? DEFAULTS.baseUrl).replace(/\/$/, '')
    this.apiKey = (options.apiKey ?? '').trim()
    const globalFetch = (globalThis.fetch as FetchLike | undefined)?.bind(globalThis)
    if (!options.fetchFn && !globalFetch) {
      throw new YoutubeError('network', 'No fetch implementation available')
    }
    this.fetchFn = options.fetchFn ?? (globalFetch as FetchLike)
    this.now = options.now ?? Date.now
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
    if (this.apiKey) search.set('key', this.apiKey)
    const qs = search.toString()
    return `${this.baseUrl}${path}?${qs}`
  }

  /** GET with TTL cache; returns the parsed body (validated by the caller). */
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
    let res: Response
    try {
      res = await this.fetchFn(url, {
        headers: { Accept: 'application/json' },
        signal: this.makeSignal(),
      })
    } catch (err) {
      if (isAbort(err)) throw new YoutubeError('timeout', 'YouTube request timed out')
      throw new YoutubeError('network', err instanceof Error ? err.message : 'YouTube request failed')
    }

    let parsed: unknown = null
    try {
      parsed = await res.json()
    } catch {
      throw new YoutubeError('malformed', 'YouTube returned invalid JSON', res.status)
    }

    const body = parsed as { error?: YoutubeApiError } | null
    if (!res.ok || body?.error) {
      const apiErr = body?.error
      const reason = apiErr?.errors?.[0]?.reason ?? ''
      const message = apiErr?.message ?? `YouTube HTTP ${res.status}`
      if (res.status === 403 && (reason === 'quotaExceeded' || reason === 'dailyLimitExceeded')) {
        throw new YoutubeError('quota', message, 403)
      }
      if (res.status === 403) throw new YoutubeError('forbidden', message, 403)
      if (res.status === 400 && reason === 'invalidRelevanceLanguage') {
        throw new YoutubeError('api', message, 400)
      }
      throw new YoutubeError('api', message, res.status)
    }
    return parsed
  }

  private makeSignal(): AbortSignal | undefined {
    if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
      return AbortSignal.timeout(this.timeoutMs)
    }
    return undefined
  }

  // — Endpoints ————————————————————————————————————————————————————————

  /**
   * `search.list` for embeddable videos. `language` → relevanceLanguage,
   * `cursor` → pageToken (opaque, from a previous response).
   */
  async searchVideos(opts: {
    query: string
    language?: string
    cursor?: string
    limit?: number
    ttlMs?: number
  }): Promise<{ items: YoutubeSearchItem[]; nextPageToken?: string }> {
    const res = await this.request<YoutubeSearchResponse>(
      '/search',
      {
        part: 'snippet',
        type: 'video',
        videoEmbeddable: 'true',
        q: opts.query,
        maxResults: opts.limit ?? 10,
        relevanceLanguage: opts.language,
        pageToken: opts.cursor,
      },
      opts.ttlMs ?? 60_000,
    )
    if (res.error) throw new YoutubeError('api', res.error.message ?? 'YouTube search failed', res.error.code)
    const items = Array.isArray(res.items) ? res.items.filter((i) => i.id?.videoId) : []
    return { items, nextPageToken: res.nextPageToken }
  }

  /** `videos.list` — durations + made-for-kids status, or full detail by id (1 unit). */
  async getVideos(ids: string[], ttlMs?: number): Promise<YoutubeVideoItem[]> {
    if (ids.length === 0) return []
    const res = await this.request<YoutubeVideosResponse>(
      '/videos',
      {
        part: 'snippet,contentDetails,status',
        id: ids.slice(0, 50).join(','),
      },
      ttlMs ?? 5 * 60_000,
    )
    if (res.error) throw new YoutubeError('api', res.error.message ?? 'YouTube videos.list failed', res.error.code)
    return Array.isArray(res.items) ? res.items : []
  }

  /** `channels.list` — channel name/artwork for an artist page (1 unit). */
  async getChannels(ids: string[], ttlMs?: number): Promise<YoutubeChannelItem[]> {
    if (ids.length === 0) return []
    const res = await this.request<YoutubeChannelsResponse>(
      '/channels',
      { part: 'snippet', id: ids.slice(0, 50).join(',') },
      ttlMs ?? 5 * 60_000,
    )
    if (res.error) throw new YoutubeError('api', res.error.message ?? 'YouTube channels.list failed', res.error.code)
    return Array.isArray(res.items) ? res.items : []
  }
}
