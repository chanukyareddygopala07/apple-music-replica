import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CatalogProvider } from '@/domain/types'
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

const auTrack = {
  id: '6RN8l',
  title: 'Harbor Lights',
  duration: 181,
  artwork: { '480x480': 'https://images.audius.co/480.jpg' },
  user: { id: 'd08dP', name: 'Ada' },
}

/** Fresh facade (providers are module-level singletons). */
async function freshCatalog(): Promise<CatalogProvider> {
  vi.resetModules()
  return (await import('@/data/catalog')).catalog
}

/** Same generation, but the module itself (for module-level exports). */
async function freshCatalogModule(): Promise<CatalogModule> {
  vi.resetModules()
  return import('@/data/catalog')
}

/** Same module generation as freshCatalog() — registry state must match. */
async function freshRegistry(): Promise<typeof import('@/data/remote-registry')> {
  return import('@/data/remote-registry')
}

function fixtureFetch(routes: Record<string, unknown>): { fn: ReturnType<typeof vi.fn>; calls: string[] } {
  const calls: string[] = []
  const fn = vi.fn(async (input: string) => {
    calls.push(input)
    const url = new URL(input)
    for (const [pattern, body] of Object.entries(routes)) {
      if (url.pathname.endsWith(pattern)) return http(body)
    }
    return http({}, 404)
  })
  vi.stubGlobal('fetch', fn)
  return { fn, calls }
}

function audiusOn(): void {
  vi.stubEnv('VITE_AUDIUS_ENABLED', '1')
}

function audiusOff(): void {
  vi.stubEnv('VITE_AUDIUS_ENABLED', '0')
}

beforeEach(() => clearRemoteEntities())
afterEach(() => {
  clearRemoteEntities()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('facade with Audius disabled (VITE_AUDIUS_ENABLED=0)', () => {
  it('search stays demo-only and makes zero network requests', async () => {
    audiusOff()
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const catalog = await freshCatalog()
    const res = await catalog.search('harbor')
    expect(res.songs.length).toBeGreaterThan(0)
    expect(res.songs.every((s) => s.id.startsWith('au-'))).toBe(false)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('home and entity reads are pure demo', async () => {
    audiusOff()
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const catalog = await freshCatalog()
    const home = await catalog.getHome()
    expect(home.features.length).toBeGreaterThan(0)
    expect(home.topCharts.every((s) => s.id.startsWith('au-'))).toBe(false)
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('facade with Audius enabled (default provider, network failing)', () => {
  it('search falls back to demo results without throwing', async () => {
    audiusOn()
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    const catalog = await freshCatalog()
    const res = await catalog.search('harbor')
    expect(res.songs.length).toBeGreaterThan(0)
    expect(res.songs.every((s) => !s.id.startsWith('au-'))).toBe(true)
  })

  it('home and browse fall back to the demo feed on failure', async () => {
    audiusOn()
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    const catalog = await freshCatalog()
    const home = await catalog.getHome()
    expect(home.features.length).toBeGreaterThan(0)
    expect(home.topCharts.length).toBeGreaterThan(0)
    const browse = await catalog.getBrowse()
    expect(browse.categories.length).toBeGreaterThan(0)
    expect(browse.topCharts.length).toBeGreaterThan(0)
  })

  it('remote entity ids resolve to null (never leak errors into views)', async () => {
    audiusOn()
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    const catalog = await freshCatalog()
    await expect(catalog.getSong('au-song-x')).resolves.toBeNull()
    await expect(catalog.getArtist('au-artist-x')).resolves.toBeNull()
    await expect(catalog.getAlbum('au-album-t-x')).resolves.toBeNull()
    await expect(catalog.getPlaylist('au-playlist-x')).resolves.toBeNull()
    await expect(catalog.getSongsByAlbum('au-album-t-x')).resolves.toEqual([])
    // Demo entities keep working with zero network.
    await expect(catalog.getSong('s-mg-1')).resolves.toMatchObject({ id: 's-mg-1' })
  })
})

describe('facade with Audius enabled (live-shaped fixtures)', () => {
  it('search puts Audius hits ahead of demo matches and registers entities', async () => {
    audiusOn()
    fixtureFetch({
      '/tracks/search': { data: [auTrack] },
      '/users/search': { data: [{ id: 'd08dP', name: 'Ada' }] },
      '/playlists/search': { data: [{ id: 'Dv9QV', playlist_name: 'Chill' }] },
    })
    const catalog = await freshCatalog()
    const registry = await freshRegistry()
    const res = await catalog.search('harbor')
    expect(res.songs[0]).toMatchObject({
      id: 'au-song-6RN8l',
      audioUrl: 'https://api.audius.co/v1/tracks/6RN8l/stream',
      artworkUrl: 'https://images.audius.co/480.jpg',
    })
    expect(res.songs.some((s) => !s.id.startsWith('au-'))).toBe(true) // demo supplement
    expect(res.artists[0]?.id).toBe('au-artist-d08dP')
    expect(res.playlists[0]?.id).toBe('au-playlist-Dv9QV')
    expect(registry.remoteSong('au-song-6RN8l')?.title).toBe('Harbor Lights')
    expect(registry.remoteArtist('au-artist-d08dP')?.name).toBe('Ada')
  })

  it('entity lookups route au-* ids to Audius and demo ids to the demo provider', async () => {
    audiusOn()
    const { calls } = fixtureFetch({ '/tracks/6RN8l': { data: [auTrack] } })
    const catalog = await freshCatalog()

    const remote = await catalog.getSong('au-song-6RN8l')
    expect(remote).toMatchObject({ id: 'au-song-6RN8l', artistIds: ['au-artist-d08dP'] })

    const fetches = calls.length
    const local = await catalog.getSong('s-mg-1')
    expect(local?.id).toBe('s-mg-1')
    expect(calls.length).toBe(fetches) // demo path never fetches
  })

  it('home overlays Audius charts over the demo editorial base', async () => {
    audiusOn()
    fixtureFetch({
      '/tracks/trending': { data: [auTrack] },
      '/tracks/trending/underground': { data: [auTrack] },
      '/playlists/trending': { data: [{ id: 'Tp1', playlist_name: 'Top Mix' }] },
    })
    const catalog = await freshCatalog()
    const home = await catalog.getHome()
    expect(home.features.length).toBeGreaterThan(0) // demo editorial kept
    expect(home.topCharts[0]?.id).toBe('au-song-6RN8l')
    expect(home.bestNewSongs[0]?.id).toBe('au-song-6RN8l')
    expect(home.madeForYou[0]?.id).toBe('au-playlist-Tp1')
  })
})

describe('facade provider surface', () => {
  it('reports all three providers to Settings', async () => {
    audiusOff()
    const mod: CatalogModule = await freshCatalogModule()
    const infos = mod.providerInfos()
    expect(infos.map((i) => i.id)).toEqual(['demo', 'audius', 'musickit'])
    expect(infos.find((i) => i.id === 'audius')?.configured).toBe(false)
  })
})
