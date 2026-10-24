import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { JamendoClient, JamendoError, type JamendoRawTrack } from '@/data/jamendo-client'
import { JamendoProvider } from '@/data/jamendo-provider'
import {
  JM_ALBUM,
  JM_ALBUM_SINGLE,
  JM_ARTIST,
  JM_SONG,
} from '@/data/jamendo-normalize'
import { clearRemoteEntities, remoteAlbum, remoteArtist, remoteSong } from '@/data/remote-registry'

function http(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => body,
  } as unknown as Response
}

function envelope(results: unknown[]): unknown {
  return { headers: { status: 'success', code: 0, results_count: results.length }, results }
}

function rawTrack(id: string, extra: Partial<JamendoRawTrack> = {}): JamendoRawTrack {
  return {
    id,
    name: `Track ${id}`,
    duration: 120,
    artist_id: 'a1',
    artist_name: 'Ada',
    album_id: 'al1',
    album_name: 'Album One',
    album_image: 'https://usercontent.jamendo.com?type=album&id=al1',
    image: 'https://usercontent.jamendo.com?type=album&id=al1',
    audio: `https://prod-1.storage.jamendo.com/?trackid=${id}&format=mp32`,
    license_ccurl: 'http://creativecommons.org/licenses/by-sa/3.0/',
    shareurl: `https://www.jamendo.com/track/${id}`,
    position: 1,
    ...extra,
  }
}

function providerWith(fetchFn: ReturnType<typeof vi.fn>, clientId = 'test-client'): JamendoProvider {
  const client = new JamendoClient({
    fetchFn: fetchFn as unknown as (input: string, init?: RequestInit) => Promise<Response>,
    clientId,
  })
  return new JamendoProvider(client, { enabled: true, clientId })
}

function callUrl(fetchFn: ReturnType<typeof vi.fn>, index = 0): URL {
  return new URL(String(fetchFn.mock.calls[index]?.[0]))
}

beforeEach(() => clearRemoteEntities())
afterEach(() => {
  clearRemoteEntities()
  vi.restoreAllMocks()
})

describe('JamendoProvider.searchPage', () => {
  it('answers an empty query locally without touching the network', async () => {
    const fetchFn = vi.fn()
    const page = await providerWith(fetchFn).searchPage('   ')
    expect(page.results.songs).toEqual([])
    expect(page.cursor).toBeUndefined()
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('searches with the documented params and registers entities for the UI', async () => {
    const fetchFn = vi.fn().mockResolvedValue(http(envelope([rawTrack('1848357')])))
    const provider = providerWith(fetchFn)
    const page = await provider.searchPage('mañana')

    expect(callUrl(fetchFn).searchParams.get('search')).toBe('mañana')
    expect(page.results.songs[0]).toMatchObject({
      id: `${JM_SONG}1848357`,
      source: 'jamendo',
      attribution: 'Jamendo',
    })
    // Registry lookups power song rows / artist links / album links synchronously.
    expect(remoteSong(`${JM_SONG}1848357`)?.title).toBe('Track 1848357')
    expect(remoteArtist(`${JM_ARTIST}a1`)?.name).toBe('Ada')
    expect(remoteAlbum(`${JM_ALBUM}al1`)?.title).toBe('Album One')
    expect(page.results.artists[0]?.id).toBe(`${JM_ARTIST}a1`)
    expect(page.results.albums[0]?.id).toBe(`${JM_ALBUM}al1`)
  })

  it('sends no restrictive lang parameter for all-languages searches', async () => {
    const fetchFn = vi.fn().mockResolvedValue(http(envelope([])))
    const provider = providerWith(fetchFn)
    await provider.searchPage('harbor')
    await provider.searchPage('sunrise', { language: 'all' })
    expect(callUrl(fetchFn).searchParams.get('lang')).toBeNull()
    expect(callUrl(fetchFn, 1).searchParams.get('lang')).toBeNull()
  })

  it('maps supported app languages onto Jamendo’s 2-letter lang wire value', async () => {
    const fetchFn = vi.fn().mockResolvedValue(http(envelope([])))
    const provider = providerWith(fetchFn)
    await provider.searchPage('harbor', { language: 'fr' })
    expect(callUrl(fetchFn).searchParams.get('lang')).toBe('fr')
    await provider.searchPage('sunrise', { language: 'zh-Hans' })
    expect(callUrl(fetchFn, 1).searchParams.get('lang')).toBe('zh') // iso 639-1
    await provider.searchPage('moonlight', { language: 'zh-Hant' })
    expect(callUrl(fetchFn, 2).searchParams.get('lang')).toBe('zh')
  })

  it('pages with an opaque cursor only while full pages remain', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(http(envelope(Array.from({ length: 10 }, (_, i) => rawTrack(`t${i}`)))))
      .mockResolvedValueOnce(http(envelope([rawTrack('t10')])))
    const provider = providerWith(fetchFn)

    const first = await provider.searchPage('harbor', { limit: 10 })
    expect(first.cursor).toBe('10')
    expect(first.results.songs).toHaveLength(10)

    const second = await provider.searchPage('harbor', { cursor: first.cursor, limit: 10 })
    expect(second.cursor).toBeUndefined() // short page = no more results
    expect(callUrl(fetchFn, 1).searchParams.get('offset')).toBe('10')
  })

  it('maps a transport failure to a typed rejection (the facade isolates it)', async () => {
    const fetchFn = vi.fn().mockResolvedValue(http({}, 500))
    const err = await providerWith(fetchFn).searchPage('harbor').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(JamendoError)
    expect((err as JamendoError).code).toBe('http')
  })
})

describe('JamendoProvider without a client id', () => {
  it('reports unconfigured and issues zero requests', async () => {
    const fetchFn = vi.fn()
    const provider = providerWith(fetchFn, '')
    expect(provider.info).toMatchObject({ id: 'jamendo', configured: false })
    expect(provider.info.description).toContain('VITE_JAMENDO_CLIENT_ID')

    const err = await provider.searchPage('harbor').catch((e: unknown) => e)
    expect((err as JamendoError).code).toBe('unconfigured')
    expect(fetchFn).not.toHaveBeenCalled()

    await expect(provider.getSong(`${JM_SONG}1`)).rejects.toMatchObject({ code: 'unconfigured' })
    expect(fetchFn).not.toHaveBeenCalled()
  })
})

describe('JamendoProvider entity reads', () => {
  it('routes jm-* ids and returns null/[] for foreign or unsupported ids', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(http(envelope([rawTrack('1848357')]))) // getSong
      .mockResolvedValue(http(envelope([])))
    const provider = providerWith(fetchFn)

    const song = await provider.getSong(`${JM_SONG}1848357`)
    expect(song?.id).toBe(`${JM_SONG}1848357`)

    const calls = fetchFn.mock.calls.length
    await expect(provider.getSong('au-song-1')).resolves.toBeNull()
    await expect(provider.getSong('s-mg-1')).resolves.toBeNull()
    await expect(provider.getArtist(`${JM_ARTIST}nope`)).resolves.toBeNull() // empty endpoint → null
    expect(fetchFn.mock.calls.length).toBeGreaterThan(calls) // artist fetch happened
    // Playlist / genre are documented as unsupported — never invented.
    await expect(provider.getPlaylist(`${JM_ALBUM}1`)).resolves.toBeNull()
    await expect(provider.getGenre('rock')).resolves.toBeNull()
    await expect(provider.getStations()).resolves.toEqual([])
    await expect(provider.getHome()).resolves.toMatchObject({ features: [] })
  })

  it('fetches a real album with its track list', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(http(envelope([{ id: 'al1', name: 'Album One', artist_id: 'a1', image: 'https://usercontent.jamendo.com?type=album&id=al1', releasedate: '2024-01-01' }])))
      .mockResolvedValueOnce(http(envelope([rawTrack('t1'), rawTrack('t2', { position: 2 })])))
    const provider = providerWith(fetchFn)
    const album = await provider.getAlbum(`${JM_ALBUM}al1`)
    expect(album).toMatchObject({ id: `${JM_ALBUM}al1`, title: 'Album One' })
    expect(album?.songIds).toEqual([`${JM_SONG}t1`, `${JM_SONG}t2`])
    expect(callUrl(fetchFn, 1).searchParams.get('album_id')).toBe('al1')
  })

  it('resolves a synthesised single-album id through its track', async () => {
    const fetchFn = vi.fn().mockResolvedValue(http(envelope([rawTrack('999', { album_id: undefined, album_image: undefined })])))
    const provider = providerWith(fetchFn)
    const album = await provider.getAlbum(`${JM_ALBUM_SINGLE}999`)
    expect(album).toMatchObject({ id: `${JM_ALBUM_SINGLE}999`, kind: 'single' })
    const songs = await provider.getSongsByAlbum(`${JM_ALBUM_SINGLE}999`)
    expect(songs.map((s) => s.id)).toEqual([`${JM_SONG}999`])
  })

  it("reads an artist's albums and top songs, keeping only usable rows", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(http(envelope([{ id: 'al1', name: 'Album One', artist_id: 'a1' }, { name: 'no id' }])))
      .mockResolvedValueOnce(http(envelope([rawTrack('t1'), rawTrack('t2', { audio: undefined })])))
    const provider = providerWith(fetchFn)

    const albums = await provider.getAlbumsByArtist(`${JM_ARTIST}a1`)
    expect(albums.map((a) => a.id)).toEqual([`${JM_ALBUM}al1`]) // un-usable row dropped
    expect(callUrl(fetchFn).searchParams.get('artist_id')).toBe('a1')

    const songs = await provider.getTopSongsByArtist(`${JM_ARTIST}a1`)
    expect(songs.map((s) => s.id)).toEqual([`${JM_SONG}t1`]) // stream-less track dropped
    expect(callUrl(fetchFn, 1).searchParams.get('artist_id')).toBe('a1')
    expect(callUrl(fetchFn, 1).searchParams.get('limit')).toBe('8')
  })
})
