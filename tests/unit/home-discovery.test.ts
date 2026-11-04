import { beforeEach, describe, expect, it, vi } from 'vitest'
import { searchGrouped } from '@/data/catalog'
import { HOME_DISCOVERY_LIMIT, HOME_DISCOVERY_QUERY, discoverHomeYouTube, resetHomeDiscovery } from '@/data/home-discovery'
import { clearDiscoveredPool, discoveredSongs, shelvesByLanguage } from '@/data/discovery-pool'
import type { GroupedSearchResults, SearchGroupStatus, Song } from '@/domain/types'

vi.mock('@/data/catalog', () => ({ searchGrouped: vi.fn() }))

const searchGroupedMock = vi.mocked(searchGrouped)
const CACHE_KEY = 'realaxify:home-discovery:v1'

function ytSong(id: string, language?: string): Song {
  return {
    id,
    title: `Song ${id}`,
    albumId: `yt-album-${id}`,
    artistIds: ['yt-artist-UC1'],
    durationMs: 210_000,
    trackNumber: 0,
    audioUrl: '',
    source: 'youtube',
    playbackKind: 'youtube',
    artworkUrl: `https://i.ytimg.com/vi/${id}/hq720.jpg`,
    externalUrl: `https://www.youtube.com/watch?v=${id}`,
    ...(language ? { language } : {}),
  }
}

function grouped(
  status: SearchGroupStatus,
  songs: Song[] = [],
  message?: string,
): GroupedSearchResults {
  return {
    query: HOME_DISCOVERY_QUERY,
    language: 'all',
    source: 'youtube',
    hiddenSources: [],
    groups: [
      { source: 'youtube', name: 'YouTube', status, message, results: { query: HOME_DISCOVERY_QUERY, songs, albums: [], artists: [], playlists: [] } },
    ],
  }
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (err: unknown) => void } {
  let resolve!: (value: T) => void
  let reject!: (err: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

beforeEach(() => {
  resetHomeDiscovery()
  clearDiscoveredPool()
  sessionStorage.clear()
  searchGroupedMock.mockReset()
})

describe('discoverHomeYouTube (single-flight + one request per session)', () => {
  it('shares one in-flight search across concurrent callers', async () => {
    const d = deferred<GroupedSearchResults>()
    searchGroupedMock.mockReturnValue(d.promise)

    const first = discoverHomeYouTube()
    const second = discoverHomeYouTube()
    expect(first).toBe(second)

    d.resolve(grouped('ok', [ytSong('dQw4w9WgXcQ', 'te')]))
    const [a, b] = await Promise.all([first, second])
    expect(a).toEqual(b)
    expect(searchGroupedMock).toHaveBeenCalledTimes(1)
  })

  it('queries once with the shared music query, YouTube-only, at the widened page size', async () => {
    searchGroupedMock.mockResolvedValue(grouped('empty'))
    await discoverHomeYouTube()
    expect(searchGroupedMock).toHaveBeenCalledTimes(1)
    expect(searchGroupedMock).toHaveBeenCalledWith(HOME_DISCOVERY_QUERY, {
      source: 'youtube',
      limit: HOME_DISCOVERY_LIMIT,
    })
    expect(HOME_DISCOVERY_QUERY).toBe('music')
    // Quota-neutral: still a single call; the page size only widens the net.
    expect(HOME_DISCOVERY_LIMIT).toBe(50)
  })

  it('serves the session cache instead of a second search', async () => {
    searchGroupedMock.mockResolvedValue(grouped('ok', [ytSong('aaaaaaaaaaa', 'te')]))
    await discoverHomeYouTube()
    await discoverHomeYouTube()
    expect(searchGroupedMock).toHaveBeenCalledTimes(1)
    expect(sessionStorage.getItem(CACHE_KEY)).not.toBeNull()
  })

  it('skips an expired cache entry (TTL), searching once more', async () => {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify({ t: Date.now() - 31 * 60_000, songs: [ytSong('old')] }))
    searchGroupedMock.mockResolvedValue(grouped('ok', [ytSong('bbbbbbbbbbb', 'hi')]))
    const result = await discoverHomeYouTube()
    expect(searchGroupedMock).toHaveBeenCalledTimes(1)
    expect(result.songs[0]?.id).toBe('bbbbbbbbbbb')
  })

  it('never caches failures — the next caller searches again', async () => {
    searchGroupedMock.mockResolvedValueOnce(grouped('error', [], 'boom'))
    const first = await discoverHomeYouTube()
    expect(first.status).toBe('error')
    expect(sessionStorage.getItem(CACHE_KEY)).toBeNull()

    searchGroupedMock.mockResolvedValueOnce(grouped('ok', [ytSong('ccccccccccc')]))
    const second = await discoverHomeYouTube()
    expect(second.status).toBe('ok')
    expect(searchGroupedMock).toHaveBeenCalledTimes(2)
  })
})

describe('discoverHomeYouTube status mapping', () => {
  it('ok group with songs resolves ok', async () => {
    searchGroupedMock.mockResolvedValue(grouped('ok', [ytSong('ddddddddddd', 'te')]))
    const result = await discoverHomeYouTube()
    expect(result.status).toBe('ok')
    expect(result.songs).toHaveLength(1)
  })

  it('ok group with zero songs resolves empty', async () => {
    searchGroupedMock.mockResolvedValue(grouped('ok'))
    expect((await discoverHomeYouTube()).status).toBe('empty')
  })

  it('empty group resolves empty', async () => {
    searchGroupedMock.mockResolvedValue(grouped('empty'))
    expect((await discoverHomeYouTube()).status).toBe('empty')
  })

  it('error group resolves error with its message', async () => {
    searchGroupedMock.mockResolvedValue(grouped('error', [], 'Search failed: quota'))
    const result = await discoverHomeYouTube()
    expect(result.status).toBe('error')
    expect(result.message).toBe('Search failed: quota')
  })

  it('unconfigured group resolves unavailable with the config message', async () => {
    searchGroupedMock.mockResolvedValue(grouped('unconfigured', [], 'Needs a free API key: set VITE_YOUTUBE_API_KEY.'))
    const result = await discoverHomeYouTube()
    expect(result.status).toBe('unavailable')
    expect(result.message).toContain('VITE_YOUTUBE_API_KEY')
  })

  it('missing group resolves unavailable with honest copy', async () => {
    searchGroupedMock.mockResolvedValue({
      query: HOME_DISCOVERY_QUERY,
      language: 'all',
      source: 'youtube',
      hiddenSources: [],
      groups: [],
    })
    const result = await discoverHomeYouTube()
    expect(result.status).toBe('unavailable')
    expect(result.message).toContain('unavailable')
  })

  it('thrown (non-abort) errors resolve error, never reject', async () => {
    searchGroupedMock.mockRejectedValue(new Error('network down'))
    const result = await discoverHomeYouTube()
    expect(result.status).toBe('error')
    expect(result.message).toBe('YouTube search could not be completed.')
  })

  it('abort errors propagate (cancellation is not a UI failure)', async () => {
    const abort = new Error('aborted')
    abort.name = 'AbortError'
    searchGroupedMock.mockRejectedValue(abort)
    await expect(discoverHomeYouTube()).rejects.toBe(abort)
  })
})

describe('discovery pool reuse (one fetch feeds both sections)', () => {
  it('ingests mappable songs so language shelves come from the same request', async () => {
    searchGroupedMock.mockResolvedValue(
      grouped('ok', [ytSong('eeeeeeeeeee', 'te'), ytSong('fffffffffffe', 'hi'), ytSong('ggggggggggg', 'ceb')]),
    )
    const result = await discoverHomeYouTube()
    expect(result.songs).toHaveLength(3)

    expect(discoveredSongs().map((s) => s.id)).toEqual(['eeeeeeeeeee', 'fffffffffffe'])
    expect(shelvesByLanguage().map((s) => s.code)).toEqual(['hi', 'te']) // catalogue-order tiebreak
  })

  it('a cached read re-ingests the pool (shelves survive a reload)', async () => {
    searchGroupedMock.mockResolvedValue(grouped('ok', [ytSong('hhhhhhhhhhh', 'te')]))
    await discoverHomeYouTube()

    // Simulate a reload: pool memory is gone, sessionStorage cache remains.
    clearDiscoveredPool()
    expect(shelvesByLanguage()).toEqual([])

    const result = await discoverHomeYouTube()
    expect(result.status).toBe('ok')
    expect(searchGroupedMock).toHaveBeenCalledTimes(1)
    expect(shelvesByLanguage().map((s) => s.code)).toEqual(['te'])
  })
})
