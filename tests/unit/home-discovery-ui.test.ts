import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HomeFeed, Song } from '@/domain/types'
import { renderHome } from '@/views/home'
import { bindGlobalActions } from '@/app/actions'
import { router } from '@/app/router-bridge'
import { PlayerEngine, player } from '@/engine/player'
import { searchGrouped } from '@/data/catalog'
import { clearDiscoveredPool } from '@/data/discovery-pool'
import { resetHomeDiscovery } from '@/data/home-discovery'
import { clearRemoteEntities, registerRemoteEntities } from '@/data/remote-registry'

const mocks = vi.hoisted(() => ({
  getHome: vi.fn(),
  getSong: vi.fn(async () => null),
  getAlbum: vi.fn(async () => null),
  searchGrouped: vi.fn(),
}))

vi.mock('@/data/catalog', () => ({
  catalog: { getHome: mocks.getHome, getSong: mocks.getSong, getAlbum: mocks.getAlbum },
  searchGrouped: mocks.searchGrouped,
  resolveProviderInfos: vi.fn(async () => []),
}))

const searchGroupedMock = vi.mocked(searchGrouped)

let root: HTMLElement

/** Let queued discovery/render microtasks settle. */
async function flush(): Promise<void> {
  for (let i = 0; i < 8; i++) await Promise.resolve()
}

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function ytSong(id: string, language?: string): Song {
  return {
    id,
    title: `Video ${id}`,
    albumId: `yt-album-${id}`,
    artistIds: ['yt-artist-UCdiscover'],
    durationMs: 210_000,
    trackNumber: 0,
    audioUrl: '',
    source: 'youtube',
    playbackKind: 'youtube',
    artworkUrl: `https://i.ytimg.com/vi/${id}/hq720.jpg`,
    externalUrl: `https://www.youtube.com/watch?v=${id}`,
    ...(language ? { language, languageStatus: 'verified' as const } : {}),
  }
}

const ytTe1 = ytSong('yt-te000000001', 'te')
const ytTe2 = ytSong('yt-te000000002', 'te')
const ytEn = ytSong('yt-en000000001', 'en')

const feedHi: Song = {
  id: 'jm-hi-feed01',
  title: 'Monsoon Melody',
  albumId: 'jm-album-hi01',
  artistIds: ['jm-artist-hi01'],
  durationMs: 240_000,
  trackNumber: 1,
  audioUrl: 'https://cdn.example/hi.mp3',
  source: 'jamendo',
  playbackKind: 'audio',
  artworkUrl: 'https://cdn.example/hi.jpg',
  externalUrl: 'https://example/hi',
  language: 'hi',
  languageStatus: 'verified',
}

const feedDemo: Song = {
  id: 'demo-song-1',
  title: 'Harbor Lights',
  albumId: 'demo-album-1',
  artistIds: ['demo-artist-1'],
  durationMs: 180_000,
  trackNumber: 1,
  audioUrl: 'https://cdn.example/demo.mp3',
  playbackKind: 'audio',
  artworkUrl: 'https://cdn.example/demo.jpg',
}

const feedCeb: Song = { ...feedHi, id: 'jm-ceb-feed01', title: 'Unmappable Tongue', language: 'ceb' }

function feedStub(overrides: Partial<HomeFeed> = {}): HomeFeed {
  return {
    features: [
      {
        id: 'feat-1',
        eyebrow: 'New Release',
        title: 'Fresh Picks',
        subtitle: 'Handpicked for today',
        href: '/browse',
        artworkSeed: 'seed-1',
      },
    ],
    bestNewSongs: [feedHi, feedDemo],
    newThisWeek: [],
    madeForYou: [],
    topCharts: [],
    recentReleases: [],
    ...overrides,
  }
}

function grouped(
  status: 'ok' | 'empty' | 'error' | 'unconfigured' | 'disabled',
  songs: Song[] = [],
  message?: string,
): import('@/domain/types').GroupedSearchResults {
  return {
    query: 'music',
    language: 'all',
    source: 'youtube',
    hiddenSources: [],
    groups: [
      {
        source: 'youtube',
        name: 'YouTube',
        status,
        message,
        results: { query: 'music', songs, albums: [], artists: [], playlists: [] },
      },
    ],
  }
}

beforeEach(() => {
  HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined) as unknown as typeof HTMLMediaElement.prototype.play
  HTMLMediaElement.prototype.load = vi.fn() as unknown as typeof HTMLMediaElement.prototype.load
  HTMLMediaElement.prototype.pause = vi.fn() as unknown as typeof HTMLMediaElement.prototype.pause
  root = document.createElement('div')
  document.body.appendChild(root)
  resetHomeDiscovery()
  clearDiscoveredPool()
  clearRemoteEntities()
  sessionStorage.clear()
  mocks.getHome.mockReset()
  mocks.getSong.mockReset().mockResolvedValue(null)
  mocks.getAlbum.mockReset().mockResolvedValue(null)
  searchGroupedMock.mockReset()
  mocks.getHome.mockResolvedValue(feedStub())
  registerRemoteEntities({
    artists: [
      { id: 'yt-artist-UCdiscover', name: 'Discovery Channel', artworkSeed: 'seed', genreIds: [] },
      { id: 'jm-artist-hi01', name: 'Mira Cole', artworkSeed: 'seed', genreIds: [] },
    ],
  })
})

afterEach(() => {
  root.remove()
  clearRemoteEntities()
})

describe('Home discovery: loading', () => {
  it('renders the feed immediately while both discovery slots show skeletons', async () => {
    const d = deferred<ReturnType<typeof grouped>>()
    searchGroupedMock.mockReturnValue(d.promise)

    await renderHome(root)
    await flush()

    expect(root.querySelector('h1')?.textContent).toBe('Home')
    expect(root.querySelector('.editorial-card')).toBeTruthy()
    expect(root.querySelectorAll('.song-row').length).toBeGreaterThan(0)
    // Discovery still pending: both slots hold skeleton cards under their headers.
    expect(root.querySelector('[data-yt-section] .section-title')?.textContent).toContain('YouTube Music')
    expect(root.querySelector('[data-yt-section] .skeleton')).toBeTruthy()
    expect(root.querySelector('[data-lang-section] .section-title')?.textContent).toContain('Explore by Language')
    expect(root.querySelector('[data-lang-section] .skeleton')).toBeTruthy()

    d.resolve(grouped('ok', [ytTe1]))
    await flush()
    expect(root.querySelector('[data-yt-section] .skeleton')).toBeNull()
    expect(root.querySelector('[data-yt-section] .yt-card')).toBeTruthy()
  })
})

describe('Home discovery: ok state feeds both sections from one request', () => {
  it('builds language shelves and YouTube cards with one search', async () => {
    searchGroupedMock.mockResolvedValue(grouped('ok', [ytTe1, ytTe2, ytEn]))

    await renderHome(root)
    await flush()

    expect(searchGroupedMock).toHaveBeenCalledTimes(1)

    // Explore by Language: header + shelves (feed hi + discovery te/en).
    const langSection = root.querySelector('[data-lang-section]')
    expect(langSection?.querySelector('.section-title')?.textContent).toContain('Explore by Language')
    const shelfCodes = [...(langSection?.querySelectorAll('section.lang-shelf') ?? [])].map((s) =>
      s.getAttribute('data-language'),
    )
    expect(shelfCodes).toEqual(['te', 'en', 'hi']) // richest first, catalogue-order tiebreak

    const teShelf = langSection?.querySelector('section.lang-shelf[data-language="te"]')
    expect(teShelf?.getAttribute('aria-label')).toBe('Telugu songs')
    expect(teShelf?.querySelectorAll('.song-row')).toHaveLength(2)
    expect(teShelf?.querySelector('.language-badge')?.textContent).toBe('Telugu')
    expect(teShelf?.querySelector('.source-badge')?.textContent).toBe('YouTube')
    // Single-source shelf pins See All to that source + the shared query.
    expect(teShelf?.querySelector('.section-title')?.getAttribute('href')).toBe(
      '/search?q=music&lang=te&src=youtube',
    )
    const hiShelf = langSection?.querySelector('section.lang-shelf[data-language="hi"]')
    expect(hiShelf?.querySelector('.section-title')?.getAttribute('href')).toBe(
      '/search?q=music&lang=hi&src=jamendo',
    )

    // YouTube Music: watch links, provider/language badges, duration — never a play button.
    const ytSection = root.querySelector('[data-yt-section]')
    expect(ytSection?.querySelector('.section-title')?.textContent).toContain('YouTube Music')
    const cards = [...(ytSection?.querySelectorAll('.yt-card') ?? [])]
    expect(cards).toHaveLength(3)
    expect(cards[0]?.getAttribute('href')).toBe('/watch/yt-te000000001')
    expect(cards[0]?.getAttribute('aria-label')).toContain('Video yt-te000000001')
    expect(cards[0]?.querySelector('.language-badge')?.textContent).toBe('Telugu')
    expect(cards[0]?.querySelector('.source-badge')?.textContent).toBe('YouTube')
    expect(cards[0]?.querySelector('.yt-duration')?.textContent).toBe('3:30')
    expect(ytSection?.querySelector('[data-action="play-song"]')).toBeNull()

    // Feed rows: language-bearing row labelled, unknown row unlabelled.
    const feedRow = root.querySelector('.song-row[data-song-id="jm-hi-feed01"]')
    expect(feedRow?.querySelector('.language-badge')?.textContent).toBe('Hindi')
    expect(feedRow?.querySelector('.source-badge')?.textContent).toBe('Jamendo')
    const demoRow = root.querySelector('.song-row[data-song-id="demo-song-1"]')
    expect(demoRow?.querySelector('.language-badge')).toBeNull()
    expect(demoRow?.querySelector('.source-badge')).toBeNull()
  })

  it('never shelves a language the catalogue cannot label', async () => {
    mocks.getHome.mockResolvedValue(feedStub({ bestNewSongs: [feedCeb, feedDemo] }))
    searchGroupedMock.mockResolvedValue(grouped('ok', [ytSong('yt-ceb0000001', 'ceb')]))

    await renderHome(root)
    await flush()

    expect(root.querySelector('[data-lang-section]')?.innerHTML ?? null).toBe('')
    const cebRow = root.querySelector('.song-row[data-song-id="jm-ceb-feed01"]')
    expect(cebRow?.querySelector('.language-badge')).toBeNull()
    expect(root.querySelectorAll('.language-badge')).toHaveLength(0)
  })
})

describe('Home discovery: honest failure states', () => {
  it('shows a retryable error state and retries only the discovery fill', async () => {
    mocks.getHome.mockResolvedValue(feedStub({ bestNewSongs: [feedDemo] }))
    searchGroupedMock.mockResolvedValueOnce(grouped('error', [], 'Search failed: quota exceeded'))

    await renderHome(root)
    await flush()

    const ytSection = root.querySelector('[data-yt-section]')
    expect(ytSection?.querySelector('.state-title')?.textContent).toBe('YouTube search is unavailable')
    expect(ytSection?.querySelector('.state-desc')?.textContent).toContain('quota exceeded')
    const retry = ytSection?.querySelector<HTMLButtonElement>('[data-action="home-discovery-retry"]')
    expect(retry).toBeTruthy()

    // Language section stays hidden: the pool has no mappable songs yet.
    expect(root.querySelector('[data-lang-section]')?.innerHTML ?? null).toBe('')

    searchGroupedMock.mockResolvedValueOnce(grouped('ok', [ytTe1]))
    retry?.click()
    await flush()

    expect(searchGroupedMock).toHaveBeenCalledTimes(2) // failure never cached
    expect(root.querySelector('[data-yt-section] .yt-card')).toBeTruthy()
    expect(root.querySelector('[data-yt-section] .state-title')).toBeNull()
    // Retried discovery now feeds the shelves too.
    expect(root.querySelector('section.lang-shelf[data-language="te"]')).toBeTruthy()
  })

  it('shows the unavailable state with the config message when YouTube is not connected', async () => {
    mocks.getHome.mockResolvedValue(feedStub({ bestNewSongs: [feedDemo] }))
    searchGroupedMock.mockResolvedValue(
      grouped('unconfigured', [], 'Needs a free API key: set VITE_YOUTUBE_API_KEY (YouTube Data API v3).'),
    )

    await renderHome(root)
    await flush()

    const ytSection = root.querySelector('[data-yt-section]')
    expect(ytSection?.querySelector('.state-title')?.textContent).toBe('YouTube search is not connected')
    expect(ytSection?.querySelector('.state-desc')?.textContent).toContain('VITE_YOUTUBE_API_KEY')
    expect(ytSection?.querySelector('[data-action="home-discovery-retry"]')).toBeNull()
    expect(root.querySelector('[data-lang-section]')?.innerHTML ?? null).toBe('')
  })

  it('shows an empty state when YouTube returns no videos', async () => {
    mocks.getHome.mockResolvedValue(feedStub({ bestNewSongs: [feedDemo] }))
    searchGroupedMock.mockResolvedValue(grouped('empty'))

    await renderHome(root)
    await flush()

    const ytSection = root.querySelector('[data-yt-section]')
    expect(ytSection?.querySelector('.state-title')?.textContent).toBe('No YouTube videos right now')
    expect(ytSection?.querySelector('.yt-card')).toBeNull()
    expect(root.querySelector('[data-lang-section]')?.innerHTML ?? null).toBe('')
  })
})

describe('Home discovery: stale-response guard', () => {
  it('drops a superseded fill so an older response never overwrites a newer render', async () => {
    const slow = deferred<ReturnType<typeof grouped>>()
    searchGroupedMock.mockReturnValueOnce(slow.promise)

    await renderHome(root)
    await flush()
    expect(root.querySelector('[data-yt-section] .skeleton')).toBeTruthy()

    // A newer render arrives with a fresh session cache (C) while the first
    // discovery (D) is still in flight.
    const cachedSongs = [ytSong('yt-hi000000001', 'hi')]
    sessionStorage.setItem('realaxify:home-discovery:v1', JSON.stringify({ t: Date.now(), songs: cachedSongs }))
    await renderHome(root)
    await flush()
    expect(root.querySelector('section.lang-shelf[data-language="hi"]')).toBeTruthy()
    expect(root.querySelector('[data-yt-section] .yt-card')).toBeTruthy()

    // The older discovery resolves afterwards — it must not repaint the DOM.
    slow.resolve(grouped('ok', [ytTe1, ytTe2]))
    await flush()
    expect(root.querySelector('section.lang-shelf[data-language="te"]')).toBeNull()
    expect(root.querySelector('section.lang-shelf[data-language="hi"]')).toBeTruthy()
    expect(root.querySelectorAll('[data-yt-section] .yt-card')).toHaveLength(1)
  })
})

describe('YouTube playback policy on Home', () => {
  it('routes a YouTube row click to /watch and never starts the audio queue', async () => {
    searchGroupedMock.mockResolvedValue(grouped('ok', [ytTe1]))
    await renderHome(root)
    await flush()

    const navSpy = vi.spyOn(router, 'navigate')
    const dispose = bindGlobalActions(root)

    const row = root.querySelector<HTMLElement>('.song-row[data-song-id="yt-te000000001"]')
    expect(row).toBeTruthy()
    row?.click()
    await flush()

    expect(navSpy).toHaveBeenCalledWith('/watch/yt-te000000001')
    expect(player.getSnapshot().queue).toHaveLength(0)
    dispose()
  })

  it('keeps YouTube videos out of the audio queue even if handed over directly', () => {
    const engine = new PlayerEngine()
    const demo: Song = { ...feedDemo }
    engine.playQueue([ytTe1, demo], 0)
    expect(engine.getSnapshot().queue.map((q) => q.songId)).toEqual(['demo-song-1'])

    const onlyYt = new PlayerEngine()
    const before = onlyYt.getSnapshot().queue
    onlyYt.playQueue([ytTe1, ytTe2])
    expect(onlyYt.getSnapshot().queue).toEqual(before)
  })
})
