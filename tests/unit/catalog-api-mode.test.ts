/**
 * Catalogue facade in API mode: remote sources route through the backend,
 * everything else stays browser-side, and the API is never required.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearRemoteEntities } from '@/data/remote-registry'

type CatalogModule = typeof import('@/data/catalog')

function http(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => body,
  } as unknown as Response
}

interface Route {
  match: string | ((url: URL) => boolean)
  body?: unknown
  status?: number
}

function stubApi(routes: Route[]): { calls: string[] } {
  const calls: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      calls.push(input)
      const url = new URL(input, 'http://localhost')
      for (const route of routes) {
        const hit = typeof route.match === 'function' ? route.match(url) : url.pathname.endsWith(route.match)
        if (hit) return http(route.body ?? {}, route.status ?? 200)
      }
      return http({ detail: 'not found' }, 404)
    }),
  )
  return { calls }
}

const HEALTH = { status: 'ok', service: 'realaxify-api', version: '0.1.0', uptimeSeconds: 1, providers: [] }

/** Server reports every remote source configured (the deployed-keys case). */
const PROVIDERS_ALL_ON: Route = {
  match: '/api/providers',
  body: {
    providers: [
      { id: 'audius', name: 'Audius', description: '', configured: true, status: 'ready' },
      { id: 'jamendo', name: 'Jamendo', description: '', configured: true, status: 'ready' },
      { id: 'youtube', name: 'YouTube', description: '', configured: true, status: 'ready' },
    ],
  },
}

const API_SONG = {
  id: 'jm-song-1848357',
  title: 'Coastal Light',
  albumId: 'jm-album-555',
  artistIds: ['jm-artist-77'],
  durationMs: 180500,
  trackNumber: 1,
  audioUrl: 'https://prod-1.storage.jamendo.com/?trackid=1848357&format=mp32',
  source: 'jamendo',
  playbackKind: 'audio',
  language: 'fr',
  languageStatus: 'verified',
}

const API_ARTIST = { id: 'jm-artist-77', name: 'Mira Cole', artworkSeed: 'jm-artist-77', genreIds: [] }

function searchRoute(source: string, songs: unknown[], extra: Record<string, unknown> = {}): Route {
  return {
    match: (url) => url.pathname.endsWith('/api/search') && url.searchParams.get('source') === source,
    body: {
      query: 'coastal',
      language: 'fr',
      source,
      groups: [
        {
          source,
          name: source === 'jamendo' ? 'Jamendo' : source === 'audius' ? 'Audius' : 'YouTube',
          status: 'ok',
          results: { query: 'coastal', songs, artists: source === 'jamendo' ? [API_ARTIST] : [] },
          ...extra,
        },
      ],
    },
  }
}

async function freshModule(): Promise<CatalogModule> {
  vi.resetModules()
  return import('@/data/catalog')
}

/**
 * Registry from the same module generation as the last freshModule() call —
 * resetModules() forks module state, so the top-level import would be stale.
 */
async function registry(): Promise<typeof import('@/data/remote-registry')> {
  return import('@/data/remote-registry')
}

beforeEach(() => {
  clearRemoteEntities()
  vi.stubEnv('VITE_API_ENABLED', '1') // skip the probe; the API is the transport
  vi.stubEnv('VITE_JAMENDO_CLIENT_ID', '') // browser-side Jamendo unconfigured
  vi.stubEnv('VITE_AUDIUS_ENABLED', '1')
})

afterEach(() => {
  clearRemoteEntities()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('search through the API', () => {
  it('routes a remote source through /api/search and maps the group', async () => {
    stubApi([{ match: '/api/health', body: HEALTH }, PROVIDERS_ALL_ON, searchRoute('jamendo', [API_SONG])])
    const mod = await freshModule()
    const grouped = await mod.searchGrouped('coastal', { language: 'fr', source: 'jamendo' })
    const group = grouped.groups[0]!
    expect(group.status).toBe('ok')
    expect(group.results.songs[0]).toMatchObject({ id: 'jm-song-1848357', source: 'jamendo', language: 'fr' })
    // Bylines resolve for API-sourced rows too.
    const reg = await registry()
    expect(reg.remoteArtist('jm-artist-77')?.name).toBe('Mira Cole')
    expect(reg.remoteSong('jm-song-1848357')?.title).toBe('Coastal Light')
  })

  it('never sends the search to a provider directly when the API answers', async () => {
    const { calls } = stubApi([PROVIDERS_ALL_ON, searchRoute('jamendo', [API_SONG])])
    const mod = await freshModule()
    await mod.searchGrouped('coastal', { source: 'jamendo' })
    const providerCalls = calls.filter((c) => !c.includes('/api/'))
    expect(providerCalls).toEqual([])
  })

  it('threads an explicit page-size limit into the /api/search query', async () => {
    const { calls } = stubApi([PROVIDERS_ALL_ON, searchRoute('youtube', [])])
    const mod = await freshModule()
    await mod.searchGrouped('music', { source: 'youtube', limit: 50 })
    const search = calls.find((c) => c.includes('/api/search'))
    expect(search).toBeDefined()
    expect(new URL(search!, 'http://localhost').searchParams.get('limit')).toBe('50')
  })

  it('demo stays browser-side even in API mode', async () => {
    const { calls } = stubApi([PROVIDERS_ALL_ON, searchRoute('audius', [])])
    const mod = await freshModule()
    const grouped = await mod.searchGrouped('harbor', { source: 'demo' })
    expect(grouped.groups[0]?.source).toBe('demo')
    expect(grouped.groups[0]?.results.songs.length).toBeGreaterThan(0)
    expect(calls.filter((c) => c.includes('/api/search'))).toEqual([])
  })

  it('falls back to the direct provider when the API errors mid-session', async () => {
    const { calls } = stubApi([
      { match: '/api/health', body: HEALTH },
      { match: (url) => url.pathname.endsWith('/api/search'), status: 500, body: { detail: 'boom' } },
      { match: '/v3.0/tracks', body: { headers: { status: 'success' }, results: [] } },
    ])
    vi.stubEnv('VITE_JAMENDO_CLIENT_ID', 'test-client-id')
    const mod = await freshModule()
    const grouped = await mod.searchGrouped('coastal', { source: 'jamendo' })
    // The direct provider answered (empty page), so no crash and no fake data.
    expect(grouped.groups[0]?.status).toBe('empty')
    expect(calls.some((c) => c.includes('api.jamendo.com'))).toBe(true)
  })

  it('a server-unconfigured source falls through to the browser-side provider', async () => {
    stubApi([
      {
        match: (url) => url.pathname.endsWith('/api/search'),
        body: {
          query: 'coastal',
          language: 'all',
          source: 'jamendo',
          groups: [
            {
              source: 'jamendo',
              name: 'Jamendo',
              status: 'unconfigured',
              message: 'Jamendo search needs a client id: set JAMENDO_CLIENT_ID on the server.',
              results: { query: 'coastal', songs: [] },
            },
          ],
        },
      },
      { match: '/v3.0/tracks', body: { headers: { status: 'success' }, results: [] } },
    ])
    vi.stubEnv('VITE_JAMENDO_CLIENT_ID', 'browser-client-id')
    const mod = await freshModule()
    const grouped = await mod.searchGrouped('coastal', { source: 'jamendo' })
    // Browser-side Jamendo is configured, so it takes over with real results.
    expect(grouped.groups[0]?.status).toBe('empty')
  })
})

describe('source availability', () => {
  it('resolveAvailableSources() adds sources configured only on the server', async () => {
    stubApi([
      {
        match: '/api/providers',
        body: {
          providers: [
            { id: 'audius', name: 'Audius', description: '', configured: true, status: 'ready' },
            { id: 'jamendo', name: 'Jamendo', description: '', configured: true, status: 'ready' },
            { id: 'youtube', name: 'YouTube', description: '', configured: false, status: 'unconfigured' },
          ],
        },
      },
    ])
    const mod = await freshModule()
    const sources = await mod.resolveAvailableSources()
    expect(sources).toContain('audius')
    expect(sources).toContain('jamendo')
    expect(sources).toContain('demo')
    expect(sources).not.toContain('youtube')
    expect(sources).not.toContain('musickit')
  })

  it('falls back to browser-side availability when the API is absent', async () => {
    vi.stubEnv('VITE_API_ENABLED', '0')
    const mod = await freshModule()
    const sources = await mod.resolveAvailableSources()
    // Canonical order: audius on by default, jamendo/youtube need keys.
    expect(sources).toEqual(['audius', 'demo'])
  })

  it('resolveProviderInfos() merges server status into the Settings list', async () => {
    stubApi([
      {
        match: '/api/providers',
        body: {
          providers: [
            { id: 'jamendo', name: 'Jamendo', description: 'CC catalogue', configured: true, status: 'ready' },
          ],
        },
      },
    ])
    const mod = await freshModule()
    const infos = await mod.resolveProviderInfos()
    const jamendo = infos.find((i) => i.id === 'jamendo')!
    expect(jamendo.configured).toBe(true)
    expect(jamendo.description).toBe('CC catalogue')
    expect(infos.find((i) => i.id === 'demo')?.configured).toBe(true)
  })
})

describe('song lookup through the API', () => {
  it('getSong() uses /api/tracks for remote ids and registers entities', async () => {
    stubApi([
      {
        match: (url) => url.pathname.includes('/api/tracks/jamendo/'),
        body: {
          track: API_SONG,
          artists: [API_ARTIST],
          albums: [{ id: 'jm-album-555', title: 'Open Skies', artistId: 'jm-artist-77', artworkSeed: 'x', kind: 'album' }],
          playlists: [],
        },
      },
    ])
    const mod = await freshModule()
    const song = await mod.catalog.getSong('jm-song-1848357')
    expect(song?.title).toBe('Coastal Light')
    expect((await registry()).remoteArtist('jm-artist-77')?.name).toBe('Mira Cole')
  })

  it('a 404 from the API is authoritative (no provider fallback)', async () => {
    const { calls } = stubApi([{ match: (url) => url.pathname.includes('/api/tracks/audius/'), status: 404 }])
    vi.stubEnv('VITE_AUDIUS_ENABLED', '1')
    const mod = await freshModule()
    expect(await mod.catalog.getSong('au-song-nope')).toBeNull()
    expect(calls.some((c) => c.includes('api.audius.co'))).toBe(false)
  })

  it('a transport error falls back to the direct provider', async () => {
    stubApi([
      { match: (url) => url.pathname.includes('/api/tracks/audius/'), status: 503, body: { detail: 'down' } },
      {
        match: (url) => url.pathname.endsWith('/tracks/6RN8l'),
        body: {
          data: {
            id: '6RN8l',
            title: 'Harbor Lights',
            duration: 181,
            artwork: { '480x480': 'https://images.audius.co/480.jpg' },
            user: { id: 'd08dP', name: 'Ada' },
          },
        },
      },
    ])
    vi.stubEnv('VITE_AUDIUS_ENABLED', '1')
    const mod = await freshModule()
    const song = await mod.catalog.getSong('au-song-6RN8l')
    expect(song?.title).toBe('Harbor Lights')
  })

  it('demo ids never touch the API', async () => {
    const { calls } = stubApi([])
    const mod = await freshModule()
    await mod.catalog.getSong('demo-song-1')
    expect(calls).toEqual([])
  })
})

describe('static-build mode', () => {
  it('VITE_API_ENABLED=0 makes zero API requests end-to-end', async () => {
    vi.stubEnv('VITE_API_ENABLED', '0')
    const { calls } = stubApi([])
    const mod = await freshModule()
    const grouped = await mod.searchGrouped('harbor', { source: 'demo' })
    expect(grouped.groups[0]?.results.songs.length).toBeGreaterThan(0)
    expect(calls).toEqual([])
  })
})

describe('search cancellation', () => {
  it('an aborted search rejects as cancelled instead of falling back or rendering stale results', async () => {
    let searchStarted: () => void = () => {}
    const started = new Promise<void>((resolve) => {
      searchStarted = resolve
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init?: RequestInit) => {
        const url = new URL(input, 'http://localhost')
        if (url.pathname.endsWith('/api/health')) return http(HEALTH)
        if (url.pathname.endsWith('/api/providers')) return http(PROVIDERS_ALL_ON.body ?? {})
        if (url.pathname.endsWith('/api/search')) {
          searchStarted()
          return new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
          })
        }
        return http({ detail: 'not found' }, 404)
      }),
    )
    const mod = await freshModule()
    const controller = new AbortController()
    const pending = mod.searchGrouped('ocean waves', { source: 'audius', signal: controller.signal })
    await started // the API search is in flight
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    // No direct-provider fallback fired for the superseded query: every request
    // this test observed went to /api (fallbacks would hit api.audius.co and
    // surface as a resolved error group, not a cancellation rejection).
  })

  it('without a signal the same search resolves normally (cancellation is opt-in)', async () => {
    stubApi([PROVIDERS_ALL_ON, searchRoute('audius', [API_SONG])])
    const mod = await freshModule()
    const grouped = await mod.searchGrouped('coastal', { source: 'audius' })
    expect(grouped.groups[0]?.status).toBe('ok')
  })
})
