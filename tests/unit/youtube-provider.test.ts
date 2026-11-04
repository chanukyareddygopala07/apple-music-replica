import { beforeEach, describe, expect, it, vi } from 'vitest'
import { YoutubeProvider } from '@/data/youtube-provider'
import { parseYoutubeConfig } from '@/data/youtube-config'
import type { YoutubeClient, YoutubeSearchItem, YoutubeVideoItem } from '@/data/youtube-client'
import { clearRemoteEntities } from '@/data/remote-registry'

const ON = parseYoutubeConfig({ apiKey: 'k' })
const OFF = parseYoutubeConfig({})

const searchItem: YoutubeSearchItem = {
  id: { kind: 'youtube#video', videoId: 'dQw4w9WgXcQ' },
  snippet: {
    title: 'Harbor Lights Live',
    channelId: 'UCxyz1234567890abcdef',
    channelTitle: 'Ada Sessions',
    thumbnails: { medium: { url: 'https://i.ytimg.com/vi/x/mq.jpg' } },
  },
}

const videoItem: YoutubeVideoItem = {
  id: 'dQw4w9WgXcQ',
  snippet: searchItem.snippet,
  contentDetails: { duration: 'PT3M33S' },
  status: { madeForKids: false },
}

function fakeClient(overrides: Partial<Record<'searchVideos' | 'getVideos' | 'getChannels', unknown>> = {}) {
  return {
    searchVideos: vi.fn().mockResolvedValue({ items: [searchItem], nextPageToken: 'NEXT' }),
    // Id-aware: only the fixture video carries a snippet/status; anything
    // else is an empty echo (so "missing id" lookups honestly resolve null).
    getVideos: vi.fn(async (ids: string[]) =>
      ids.map((id) => (id === 'dQw4w9WgXcQ' ? videoItem : { id })),
    ),
    getChannels: vi.fn(async (ids: string[]) =>
      ids.map((id) => ({ id, snippet: { title: id === 'UCxyz1234567890abcdef' ? 'Ada Sessions' : 'Chan' } })),
    ),
    ...overrides,
  }
}

function providerWith(client: ReturnType<typeof fakeClient>, config = ON): YoutubeProvider {
  return new YoutubeProvider(client as unknown as YoutubeClient, config)
}

beforeEach(() => clearRemoteEntities())

describe('YoutubeProvider info', () => {
  it('reports configuration state honestly to Settings', () => {
    expect(providerWith(fakeClient(), ON).info).toMatchObject({
      id: 'youtube',
      name: 'YouTube',
      configured: true,
    })
    expect(providerWith(fakeClient(), ON).info.description).toContain('API key set')
    const off = providerWith(fakeClient(), OFF)
    expect(off.info.configured).toBe(false)
    expect(off.info.description).toContain('VITE_YOUTUBE_API_KEY')
  })
})

describe('YoutubeProvider.searchPage', () => {
  it('never touches the network when unconfigured', async () => {
    const client = fakeClient()
    const provider = providerWith(client, OFF)
    const page = await provider.searchPage('harbor')
    expect(page.results.songs).toEqual([])
    expect(client.searchVideos).not.toHaveBeenCalled()
    expect(client.getVideos).not.toHaveBeenCalled()
    expect(client.getChannels).not.toHaveBeenCalled()
  })

  it('maps app language codes to relevanceLanguage hints', async () => {
    const client = fakeClient()
    const provider = providerWith(client)
    await provider.searchPage('x', { language: 'fr' })
    expect(client.searchVideos).toHaveBeenLastCalledWith(expect.objectContaining({ language: 'fr' }))
    await provider.searchPage('x', { language: 'zh-Hans' })
    expect(client.searchVideos).toHaveBeenLastCalledWith(expect.objectContaining({ language: 'zh-Hans' }))
    await provider.searchPage('x', { language: 'all' })
    expect(client.searchVideos).toHaveBeenLastCalledWith(expect.objectContaining({ language: undefined }))
    await provider.searchPage('x', { language: 'other' })
    expect(client.searchVideos).toHaveBeenLastCalledWith(expect.objectContaining({ language: undefined }))
  })

  it('passes the cursor through and returns the next page token', async () => {
    const client = fakeClient()
    const provider = providerWith(client)
    const page = await provider.searchPage('harbor', { cursor: 'PREV', limit: 5 })
    expect(client.searchVideos).toHaveBeenCalledWith(expect.objectContaining({ cursor: 'PREV', limit: 5 }))
    expect(page.cursor).toBe('NEXT')
  })

  it('maps search items to youtube songs, registers entities, never invents albums/playlists', async () => {
    const client = fakeClient()
    const provider = providerWith(client)
    const page = await provider.searchPage('  harbor  ')
    expect(client.searchVideos).toHaveBeenCalledWith(expect.objectContaining({ query: 'harbor' }))
    expect(page.results.songs[0]).toMatchObject({
      id: 'yt-dQw4w9WgXcQ',
      source: 'youtube',
      playbackKind: 'youtube',
      durationMs: 213_000, // duration filled from the videos.list call
      artworkUrl: 'https://i.ytimg.com/vi/x/mq.jpg',
    })
    expect(page.results.albums).toEqual([])
    expect(page.results.artists).toEqual([])
    expect(page.results.playlists).toEqual([])

    // Artist channels seen during search feed the cheap top-songs surface.
    await expect(provider.getTopSongsByArtist('yt-artist-UCxyz1234567890abcdef')).resolves.toHaveLength(1)
    await expect(provider.getTopSongsByArtist('yt-artist-unknown')).resolves.toEqual([])
    await expect(provider.getAlbumsByArtist()).resolves.toEqual([])
  })

  it('a duration lookup failure never fails the search (0 duration instead)', async () => {
    const client = fakeClient({ getVideos: vi.fn().mockRejectedValue(new Error('duration boom')) })
    const provider = providerWith(client)
    const page = await provider.searchPage('harbor')
    expect(page.results.songs[0]).toMatchObject({ id: 'yt-dQw4w9WgXcQ', durationMs: 0 })
  })

  it('lets client errors propagate (the facade isolates them to this group)', async () => {
    const client = fakeClient({ searchVideos: vi.fn().mockRejectedValue(new Error('HTTP 404')) })
    const provider = providerWith(client)
    await expect(provider.searchPage('harbor')).rejects.toThrow('HTTP 404')
  })

  it('an empty or whitespace query never fetches', async () => {
    const client = fakeClient()
    const provider = providerWith(client)
    expect((await provider.searchPage('   ')).results.songs).toEqual([])
    expect(client.searchVideos).not.toHaveBeenCalled()
  })

  it('records made-for-kids from the duration lookup (search path)', async () => {
    const client = fakeClient()
    const provider = providerWith(client)
    expect(provider.madeForKids('dQw4w9WgXcQ')).toBeUndefined()
    await provider.searchPage('harbor')
    expect(provider.madeForKids('dQw4w9WgXcQ')).toBe(false)
    expect(provider.madeForKids('unknown-video')).toBeUndefined()
  })

  it('carries defaultAudioLanguage from the videos.list facts onto the song (verified)', async () => {
    const withLang: YoutubeVideoItem = {
      ...videoItem,
      snippet: { ...searchItem.snippet, defaultAudioLanguage: 'te' },
    }
    const client = fakeClient({
      getVideos: vi.fn(async (ids: string[]) => ids.map((id) => (id === 'dQw4w9WgXcQ' ? withLang : { id }))),
    })
    const page = await providerWith(client).searchPage('harbor')
    expect(page.results.songs[0]).toMatchObject({ language: 'te', languageStatus: 'verified' })
  })

  it('never invents a language: unmappable or missing facts stay unlabelled', async () => {
    const unmappable: YoutubeVideoItem = {
      ...videoItem,
      snippet: { ...searchItem.snippet, defaultAudioLanguage: 'ceb' },
    }
    const client = fakeClient({
      getVideos: vi.fn(async (ids: string[]) => ids.map((id) => (id === 'dQw4w9WgXcQ' ? unmappable : { id }))),
    })
    const page = await providerWith(client).searchPage('harbor')
    expect(page.results.songs[0]).not.toHaveProperty('language')

    // Fact lookup failure → no duration and no language, never a guess.
    const broken = fakeClient({ getVideos: vi.fn().mockRejectedValue(new Error('facts boom')) })
    const failed = await providerWith(broken).searchPage('harbor')
    expect(failed.results.songs[0]).toMatchObject({ id: 'yt-dQw4w9WgXcQ', durationMs: 0 })
    expect(failed.results.songs[0]).not.toHaveProperty('language')
  })
})

describe('YoutubeProvider entity reads', () => {
  it('getSong resolves through videos.list and records made-for-kids', async () => {
    const client = fakeClient()
    const provider = providerWith(client)
    const song = await provider.getSong('yt-dQw4w9WgXcQ')
    expect(song).toMatchObject({ id: 'yt-dQw4w9WgXcQ', source: 'youtube', playbackKind: 'youtube' })
    expect(client.getVideos).toHaveBeenCalledWith(['dQw4w9WgXcQ'])
    expect(provider.madeForKids('dQw4w9WgXcQ')).toBe(false)
  })

  it('a videos.list failure returns null (never throws into views)', async () => {
    const client = fakeClient({ getVideos: vi.fn().mockRejectedValue(new Error('boom')) })
    const provider = providerWith(client)
    await expect(provider.getSong('yt-dQw4w9WgXcQ')).resolves.toBeNull()
  })

  it('never fetches for yt-* ids when unconfigured', async () => {
    const client = fakeClient()
    const provider = providerWith(client, OFF)
    await expect(provider.getSong('yt-dQw4w9WgXcQ')).resolves.toBeNull()
    await expect(provider.getAlbum('yt-album-dQw4w9WgXcQ')).resolves.toBeNull()
    await expect(provider.getArtist('yt-artist-UCx')).resolves.toBeNull()
    expect(client.searchVideos).not.toHaveBeenCalled()
    expect(client.getVideos).not.toHaveBeenCalled()
    expect(client.getChannels).not.toHaveBeenCalled()
  })

  it('non-yt ids return null without a request', async () => {
    const client = fakeClient()
    const provider = providerWith(client)
    await expect(provider.getSong('s-mg-1')).resolves.toBeNull()
    await expect(provider.getAlbum('al-x')).resolves.toBeNull()
    await expect(provider.getArtist('a-x')).resolves.toBeNull()
    expect(client.getVideos).not.toHaveBeenCalled()
    expect(client.getChannels).not.toHaveBeenCalled()
  })

  it('getArtist resolves through channels.list and registers the name', async () => {
    const client = fakeClient()
    const provider = providerWith(client)
    const artist = await provider.getArtist('yt-artist-UCxyz1234567890abcdef')
    expect(artist).toMatchObject({ id: 'yt-artist-UCxyz1234567890abcdef', name: 'Ada Sessions' })
    expect(client.getChannels).toHaveBeenCalledWith(['UCxyz1234567890abcdef'])
    await expect(provider.getArtist('yt-artist-UCx')).resolves.toMatchObject({ id: 'yt-artist-UCx' })
  })

  it('the single-video album resolves and carries its one song', async () => {
    const client = fakeClient()
    const provider = providerWith(client)
    const album = await provider.getAlbum('yt-album-dQw4w9WgXcQ')
    expect(album).toMatchObject({ id: 'yt-album-dQw4w9WgXcQ', title: 'Harbor Lights Live' })
    const songs = await provider.getSongsByAlbum('yt-album-dQw4w9WgXcQ')
    expect(songs.map((s) => s.id)).toEqual(['yt-dQw4w9WgXcQ'])
    await expect(provider.getSongsByAlbum('yt-album-missing')).resolves.toEqual([])
  })
})

describe('YoutubeProvider surfaces that do not exist (never invented)', () => {
  it('returns empty/null home, browse, stations, playlists and genres', async () => {
    const provider = providerWith(fakeClient())
    expect(await provider.getHome()).toEqual({
      features: [],
      bestNewSongs: [],
      newThisWeek: [],
      madeForYou: [],
      topCharts: [],
      recentReleases: [],
    })
    expect(await provider.getBrowse()).toEqual({ categories: [], newReleases: [], topCharts: [], playlists: [] })
    await expect(provider.getStations()).resolves.toEqual([])
    await expect(provider.getStation()).resolves.toBeNull()
    await expect(provider.getPlaylist()).resolves.toBeNull()
    await expect(provider.getGenre()).resolves.toBeNull()
    await expect(provider.search('harbor')).resolves.toMatchObject({ songs: expect.any(Array) })
  })
})
