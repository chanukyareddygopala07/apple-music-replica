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

/** Documented Jamendo tracks shape (developer.jamendo.com/v3.0/tracks). */
const jmTrack = {
  id: '1848357',
  name: 'Harbor Lights',
  duration: 181,
  artist_id: '421168',
  artist_name: 'Ada',
  album_id: '368084',
  album_name: 'Harbor',
  image: 'https://usercontent.jamendo.com?type=album&id=368084',
  album_image: 'https://usercontent.jamendo.com?type=album&id=368084',
  audio: 'https://prod-1.storage.jamendo.com/?trackid=1848357&format=mp32',
  license_ccurl: 'http://creativecommons.org/licenses/by-nc-nd/3.0/',
  shareurl: 'https://www.jamendo.com/track/1848357',
  musicinfo: { lang: 'en' },
}

function jamendoEnvelope(results: unknown[]): unknown {
  return { headers: { status: 'success', code: 0, results_count: results.length }, results }
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

/** Configures Jamendo the way a real deployment does (public client id). */
function jamendoOn(clientId = 'test-client-id'): void {
  vi.stubEnv('VITE_JAMENDO_CLIENT_ID', clientId)
}

/** Every provider Jamendo-grouped tests need, keyed by pathname suffix. */
function allProviderRoutes(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    '/tracks/search': { data: [auTrack] },
    '/users/search': { data: [] },
    '/playlists/search': { data: [] },
    '/v3.0/tracks': jamendoEnvelope([jmTrack]),
    ...extra,
  }
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
  it('reports every provider to Settings, Jamendo unconfigured by default', async () => {
    audiusOff()
    const mod: CatalogModule = await freshCatalogModule()
    const infos = mod.providerInfos()
    expect(infos.map((i) => i.id)).toEqual(['demo', 'audius', 'jamendo', 'musickit'])
    expect(infos.find((i) => i.id === 'audius')?.configured).toBe(false)
    expect(infos.find((i) => i.id === 'jamendo')?.configured).toBe(false)
    expect(infos.find((i) => i.id === 'jamendo')?.description).toContain('VITE_JAMENDO_CLIENT_ID')
  })
})

describe('grouped search (language + source selectors)', () => {
  it('defaults to all languages / all sources, groups in canonical order', async () => {
    audiusOn()
    fixtureFetch({
      '/tracks/search': { data: [auTrack] },
      '/users/search': { data: [] },
      '/playlists/search': { data: [] },
    })
    const mod: CatalogModule = await freshCatalogModule()
    const grouped = await mod.searchGrouped('harbor')
    expect(grouped.language).toBe('all')
    expect(grouped.source).toBe('all')
    expect(grouped.hiddenSources).toEqual([])
    expect(grouped.groups.map((g) => g.source)).toEqual(['audius', 'demo'])
    expect(grouped.groups.every((g) => g.status === 'ok')).toBe(true)
    expect(grouped.groups[0]?.results.songs[0]?.id).toBe('au-song-6RN8l')
  })

  it('flattened search equals the grouped results merged', async () => {
    audiusOn()
    fixtureFetch({
      '/tracks/search': { data: [auTrack] },
      '/users/search': { data: [] },
      '/playlists/search': { data: [] },
    })
    const mod: CatalogModule = await freshCatalogModule()
    const grouped = await mod.searchGrouped('harbor')
    const flat = await mod.search('harbor')
    expect(flat).toEqual(mod.flattenGrouped(grouped))
    expect(flat.songs[0]?.id).toBe('au-song-6RN8l')
    expect(flat.songs.some((s) => !s.id.startsWith('au-'))).toBe(true)
  })

  it('availableSources reflects configuration and never unwired sources', async () => {
    audiusOn()
    const on: CatalogModule = await freshCatalogModule()
    expect(on.availableSources()).toEqual(['audius', 'demo']) // Jamendo needs a client id
    expect(on.availableSources().some((s) => s === 'youtube')).toBe(false) // never wired

    audiusOff()
    const off: CatalogModule = await freshCatalogModule()
    expect(off.availableSources()).toEqual(['demo'])

    audiusOn()
    vi.stubEnv('VITE_MUSICKIT_ENABLED', '1')
    vi.stubEnv('VITE_MUSICKIT_DEVELOPER_TOKEN', 'aaa.bbb.ccc')
    const withMusicKit: CatalogModule = await freshCatalogModule()
    expect(withMusicKit.availableSources()).toEqual(['audius', 'musickit', 'demo'])
  })

  it('offers Jamendo exactly when a client id is configured', async () => {
    audiusOn()
    vi.stubEnv('VITE_JAMENDO_CLIENT_ID', 'test-client-id')
    const configured: CatalogModule = await freshCatalogModule()
    expect(configured.availableSources()).toEqual(['audius', 'jamendo', 'demo'])

    vi.stubEnv('VITE_JAMENDO_ENABLED', '0')
    const forceDisabled: CatalogModule = await freshCatalogModule()
    expect(forceDisabled.availableSources()).toEqual(['audius', 'demo'])

    vi.unstubAllEnvs()
    audiusOn()
    const noClientId: CatalogModule = await freshCatalogModule()
    expect(noClientId.availableSources().some((s) => s === 'jamendo')).toBe(false)
  })

  it('hides sources that cannot filter by the selected language', async () => {
    audiusOn()
    fixtureFetch({
      '/tracks/search': { data: [auTrack] },
      '/users/search': { data: [] },
      '/playlists/search': { data: [] },
    })
    const mod: CatalogModule = await freshCatalogModule()
    const english = await mod.searchGrouped('harbor', { language: 'en' })
    expect(english.language).toBe('en')
    expect(english.groups.map((g) => g.source)).toEqual(['demo'])
    expect(english.hiddenSources).toEqual(['audius'])
    expect(english.groups[0]?.status).toBe('ok')
  })

  it('searches nothing (and lists every source) when none can filter', async () => {
    audiusOn()
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const mod: CatalogModule = await freshCatalogModule()
    const french = await mod.searchGrouped('harbor', { language: 'fr' })
    expect(french.groups).toEqual([])
    expect(french.hiddenSources).toEqual(['audius', 'demo'])
    expect(mod.flattenGrouped(french).songs).toEqual([])
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('an explicit source search never queries the others', async () => {
    audiusOn()
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const mod: CatalogModule = await freshCatalogModule()
    const grouped = await mod.searchGrouped('harbor', { source: 'demo' })
    expect(grouped.groups.map((g) => g.source)).toEqual(['demo'])
    const flat = await mod.search('harbor', { source: 'demo' })
    expect(flat.songs.length).toBeGreaterThan(0)
    expect(flat.songs.every((s) => !s.id.startsWith('au-'))).toBe(true)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('reports unavailable sources honestly instead of pretending', async () => {
    audiusOff()
    const mod: CatalogModule = await freshCatalogModule()

    const audius = await mod.searchGrouped('harbor', { source: 'audius' })
    expect(audius.groups).toHaveLength(1)
    expect(audius.groups[0]).toMatchObject({ source: 'audius', status: 'disabled' })
    expect(audius.groups[0]?.message).toContain('VITE_AUDIUS_ENABLED')

    const musicKit = await mod.searchGrouped('harbor', { source: 'musickit' })
    expect(musicKit.groups[0]).toMatchObject({ source: 'musickit', status: 'unconfigured' })
    expect(musicKit.groups[0]?.message).toBeTruthy()

    const youtube = await mod.searchGrouped('harbor', { source: 'youtube' })
    expect(youtube.groups[0]).toMatchObject({ source: 'youtube', status: 'unconfigured' })
    expect(youtube.groups[0]?.message).toContain('YouTube')
  })

  it('a source that succeeds with zero hits is empty, not an error', async () => {
    audiusOn()
    fixtureFetch({
      '/tracks/search': { data: [] },
      '/users/search': { data: [] },
      '/playlists/search': { data: [] },
    })
    const mod: CatalogModule = await freshCatalogModule()
    const grouped = await mod.searchGrouped('harbor')
    const audiusGroup = grouped.groups.find((g) => g.source === 'audius')
    expect(audiusGroup?.status).toBe('empty')
    expect(audiusGroup?.message).toBeUndefined()
    // still the legacy slice path (remote group is usable, just empty)
    const flat = await mod.search('harbor')
    expect(flat).toEqual(mod.flattenGrouped(grouped))
    expect(flat.songs.length).toBeGreaterThan(0)
    expect(flat.songs.every((s) => !s.id.startsWith('au-'))).toBe(true)
  })

  it('one failing source never breaks the others (demo fallback kept)', async () => {
    audiusOn()
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    const mod: CatalogModule = await freshCatalogModule()
    const grouped = await mod.searchGrouped('harbor')
    const audiusGroup = grouped.groups.find((g) => g.source === 'audius')
    const demoGroup = grouped.groups.find((g) => g.source === 'demo')
    expect(audiusGroup?.status).toBe('error')
    expect(audiusGroup?.message).toContain('offline')
    expect(demoGroup?.status).toBe('ok')

    const flat = await mod.search('harbor')
    expect(flat.songs.length).toBeGreaterThan(0)
    expect(flat.songs.every((s) => !s.id.startsWith('au-'))).toBe(true)
  })
})

describe('grouped search with Jamendo configured (wired provider)', () => {
  it('queries every configured source in canonical order and flattens audius → jamendo → demo', async () => {
    audiusOn()
    jamendoOn()
    const { fn } = fixtureFetch(allProviderRoutes())
    const mod: CatalogModule = await freshCatalogModule()
    const grouped = await mod.searchGrouped('harbor')

    expect(grouped.groups.map((g) => g.source)).toEqual(['audius', 'jamendo', 'demo'])
    const jmGroup = grouped.groups.find((g) => g.source === 'jamendo')
    expect(jmGroup?.status).toBe('ok')
    expect(jmGroup?.results.songs[0]).toMatchObject({
      id: 'jm-song-1848357',
      source: 'jamendo',
      playbackKind: 'audio',
      attribution: 'Jamendo',
      attributionUrl: 'http://creativecommons.org/licenses/by-nc-nd/3.0/',
      language: 'en',
    })

    // All languages → no restrictive lang parameter on the wire.
    const jmCall = fn.mock.calls.map((c) => String(c[0])).find((u) => u.includes('api.jamendo.com'))
    expect(jmCall).toBeDefined()
    expect(new URL(jmCall!).searchParams.get('lang')).toBeNull()
    expect(new URL(jmCall!).searchParams.get('client_id')).toBe('test-client-id')

    const flat = mod.flattenGrouped(grouped)
    expect(flat.songs[0]?.id).toBe('au-song-6RN8l')
    expect(flat.songs[1]?.id).toBe('jm-song-1848357')
    expect(flat.songs.some((s) => !s.id.startsWith('au-') && !s.id.startsWith('jm-'))).toBe(true) // demo supplement
    expect(flat.albums[0]?.id).toBe('jm-album-368084')
  })

  it('an explicit Jamendo source queries Jamendo alone and never falls back to demo', async () => {
    audiusOn()
    jamendoOn()
    const { calls } = fixtureFetch(allProviderRoutes())
    const mod: CatalogModule = await freshCatalogModule()

    const grouped = await mod.searchGrouped('harbor', { source: 'jamendo' })
    expect(grouped.groups.map((g) => g.source)).toEqual(['jamendo'])
    expect(calls.length).toBeGreaterThan(0)
    expect(calls.every((c) => c.includes('api.jamendo.com'))).toBe(true)

    const flat = await mod.search('harbor', { source: 'jamendo' })
    expect(flat.songs.map((s) => s.id)).toEqual(['jm-song-1848357'])
    expect(flat.songs.every((s) => !s.id.startsWith('s-') && !s.id.startsWith('au-'))).toBe(true)
    expect(flat.artists[0]?.id).toBe('jm-artist-421168')
  })

  it('a Jamendo outage keeps Audius and demo results intact', async () => {
    audiusOn()
    jamendoOn()
    // No '/v3.0/tracks' route → Jamendo gets a 404 while Audius succeeds.
    fixtureFetch({
      '/tracks/search': { data: [auTrack] },
      '/users/search': { data: [] },
      '/playlists/search': { data: [] },
    })
    const mod: CatalogModule = await freshCatalogModule()
    const grouped = await mod.searchGrouped('harbor')

    const jmGroup = grouped.groups.find((g) => g.source === 'jamendo')
    expect(jmGroup?.status).toBe('error')
    expect(jmGroup?.message).toContain('Jamendo HTTP 404')
    expect(grouped.groups.find((g) => g.source === 'audius')?.status).toBe('ok')
    expect(grouped.groups.find((g) => g.source === 'demo')?.status).toBe('ok')

    const flat = mod.flattenGrouped(grouped)
    expect(flat.songs.some((s) => s.id.startsWith('au-'))).toBe(true)
    expect(flat.songs.some((s) => !s.id.startsWith('au-') && !s.id.startsWith('jm-'))).toBe(true)
  })

  it('honours a supported language: Jamendo alone stays eligible with lang on the wire', async () => {
    audiusOn()
    jamendoOn()
    const { fn } = fixtureFetch(allProviderRoutes())
    const mod: CatalogModule = await freshCatalogModule()
    const grouped = await mod.searchGrouped('harbor', { language: 'fr' })

    expect(grouped.hiddenSources).toEqual(['audius', 'demo'])
    expect(grouped.groups.map((g) => g.source)).toEqual(['jamendo'])
    const jmCall = fn.mock.calls.map((c) => String(c[0])).find((u) => u.includes('api.jamendo.com'))
    expect(new URL(jmCall!).searchParams.get('lang')).toBe('fr')
  })

  it('Other languages hides Jamendo too (no ISO code) and queries nothing', async () => {
    audiusOn()
    jamendoOn()
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const mod: CatalogModule = await freshCatalogModule()
    const grouped = await mod.searchGrouped('harbor', { language: 'other' })

    expect(grouped.groups).toEqual([])
    expect(grouped.hiddenSources).toEqual(['audius', 'jamendo', 'demo'])
    expect(mod.flattenGrouped(grouped).songs).toEqual([])
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('picking Jamendo without a client id reports unconfigured and never fetches', async () => {
    audiusOn()
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const mod: CatalogModule = await freshCatalogModule()
    const grouped = await mod.searchGrouped('harbor', { source: 'jamendo' })

    expect(grouped.groups).toHaveLength(1)
    expect(grouped.groups[0]).toMatchObject({ source: 'jamendo', status: 'unconfigured' })
    expect(grouped.groups[0]?.message).toContain('VITE_JAMENDO_CLIENT_ID')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('routes jm-* entity ids to Jamendo, demo ids to demo, and invents no playlists/genres', async () => {
    audiusOn()
    jamendoOn()
    const { calls } = fixtureFetch(
      allProviderRoutes({
        '/v3.0/albums': jamendoEnvelope([{ id: '368084', name: 'Harbor', artist_id: '421168' }]),
        '/v3.0/artists': jamendoEnvelope([{ id: '421168', name: 'Ada' }]),
      }),
    )
    const catalog = await freshCatalog()

    const song = await catalog.getSong('jm-song-1848357')
    expect(song).toMatchObject({ id: 'jm-song-1848357', source: 'jamendo' })
    expect(await catalog.getAlbum('jm-album-368084')).toMatchObject({ id: 'jm-album-368084' })
    expect(await catalog.getArtist('jm-artist-421168')).toMatchObject({ id: 'jm-artist-421168' })
    expect(await catalog.getSongsByAlbum('jm-album-368084')).toHaveLength(1)
    // Unsupported surfaces stay honestly absent.
    await expect(catalog.getPlaylist('jm-playlist-x')).resolves.toBeNull()
    await expect(catalog.getGenre('jm-genre-x')).resolves.toBeNull()

    // Demo ids never trigger a request (even with Jamendo configured).
    const before = calls.length
    await expect(catalog.getSong('s-mg-1')).resolves.toMatchObject({ id: 's-mg-1' })
    expect(calls.length).toBe(before)
  })

  it('never fetches Jamendo data for jm-* ids when the provider is unconfigured', async () => {
    audiusOn()
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const catalog = await freshCatalog()
    await expect(catalog.getSong('jm-song-1')).resolves.toBeNull()
    await expect(catalog.getAlbum('jm-album-t-1')).resolves.toBeNull()
    await expect(catalog.getArtist('jm-artist-1')).resolves.toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('registers Jamendo entities for the synchronous UI lookups', async () => {
    audiusOn()
    jamendoOn()
    fixtureFetch(allProviderRoutes())
    const mod: CatalogModule = await freshCatalogModule()
    const registry = await freshRegistry()
    await mod.searchGrouped('harbor')
    expect(registry.remoteSong('jm-song-1848357')?.title).toBe('Harbor Lights')
    expect(registry.remoteArtist('jm-artist-421168')?.name).toBe('Ada')
    expect(registry.remoteAlbum('jm-album-368084')?.title).toBe('Harbor')
  })
})
