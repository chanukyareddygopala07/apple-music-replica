import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  apiAvailable,
  apiBase,
  apiGetSong,
  apiSearchGroup,
  fetchServerProviderInfos,
  mapAlbum,
  mapArtist,
  mapGroupedResponse,
  mapPlaylist,
  mapSong,
  readApiConfig,
  resetApiProbe,
} from '@/data/api-client'
import { clearRemoteEntities, remoteArtist, remoteSong } from '@/data/remote-registry'

function http(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => body,
  } as unknown as Response
}

function stubFetch(routes: Record<string, unknown>): { calls: string[] } {
  const calls: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      calls.push(input)
      const url = new URL(input, 'http://localhost')
      for (const [pattern, body] of Object.entries(routes)) {
        if (url.pathname.endsWith(pattern)) return http(body)
      }
      return http({ detail: 'not found' }, 404)
    }),
  )
  return { calls }
}

const HEALTH = { status: 'ok', service: 'realaxify-api', version: '0.1.0', uptimeSeconds: 1, providers: [] }

const API_TRACK = {
  id: 'jm-song-1848357',
  title: 'Coastal Light',
  albumId: 'jm-album-555',
  artistIds: ['jm-artist-77'],
  durationMs: 180500,
  trackNumber: 3,
  audioUrl: 'https://prod-1.storage.jamendo.com/?trackid=1848357&format=mp32',
  artworkUrl: 'https://usercontent.jamendo.com/a.jpg',
  source: 'jamendo',
  playbackKind: 'audio',
  externalUrl: 'https://www.jamendo.com/track/1848357',
  attribution: 'Jamendo',
  attributionUrl: 'https://creativecommons.org/licenses/by-nc-nd/4.0/',
  language: 'fr',
  languageStatus: 'verified',
}

beforeEach(() => {
  clearRemoteEntities()
  resetApiProbe()
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  resetApiProbe()
})

describe('configuration', () => {
  it('reads VITE_API_ENABLED with the documented opt-out values', () => {
    expect(readApiConfig({}).enabled).toBe('unset')
    expect(readApiConfig({ VITE_API_ENABLED: '0' }).enabled).toBe('off')
    expect(readApiConfig({ VITE_API_ENABLED: 'false' }).enabled).toBe('off')
    expect(readApiConfig({ VITE_API_ENABLED: '1' }).enabled).toBe('on')
    expect(readApiConfig({ VITE_API_BASE: 'https://api.example/' }).base).toBe('https://api.example')
  })

  it('apiBase() reflects VITE_API_BASE', () => {
    vi.stubEnv('VITE_API_BASE', 'https://api.example.com')
    expect(apiBase()).toBe('https://api.example.com')
  })
})

describe('availability', () => {
  it('VITE_API_ENABLED=0 never probes', async () => {
    vi.stubEnv('VITE_API_ENABLED', '0')
    const { calls } = stubFetch({})
    expect(await apiAvailable()).toBe(false)
    expect(calls).toEqual([])
  })

  it('VITE_API_ENABLED=1 is optimistic without probing', async () => {
    vi.stubEnv('VITE_API_ENABLED', '1')
    const { calls } = stubFetch({})
    expect(await apiAvailable()).toBe(true)
    expect(calls).toEqual([])
  })

  it('unset probes /api/health once and sticks to the answer', async () => {
    const { calls } = stubFetch({ '/api/health': HEALTH })
    expect(await apiAvailable()).toBe(true)
    expect(await apiAvailable()).toBe(true)
    expect(calls).toEqual(['/api/health'])
  })

  it('a failing health probe is sticky (static hosts are not re-probed)', async () => {
    const { calls } = stubFetch({})
    expect(await apiAvailable()).toBe(false)
    expect(await apiAvailable()).toBe(false)
    expect(calls).toEqual(['/api/health'])
  })

  it('a health payload that is not "ok" counts as unavailable', async () => {
    stubFetch({ '/api/health': { status: 'degraded' } })
    expect(await apiAvailable()).toBe(false)
  })
})

describe('domain mapping', () => {
  it('maps a track into the frontend Song shape, keeping every honest field', () => {
    const song = mapSong(API_TRACK)
    expect(song).toMatchObject({
      id: 'jm-song-1848357',
      title: 'Coastal Light',
      albumId: 'jm-album-555',
      artistIds: ['jm-artist-77'],
      durationMs: 180500,
      trackNumber: 3,
      source: 'jamendo',
      playbackKind: 'audio',
      language: 'fr',
      languageStatus: 'verified',
      attribution: 'Jamendo',
    })
  })

  it('drops malformed rows instead of inventing data', () => {
    expect(mapSong({})).toBeNull()
    expect(mapSong({ id: 'x' })).toBeNull()
    expect(mapSong(null)).toBeNull()
    expect(mapSong('nope')).toBeNull()
    // A YouTube row with no audio URL is still valid (video-only playback).
    expect(mapSong({ id: 'yt-abc', title: 'Clip', albumId: 'yt-album-abc', audioUrl: '' })?.playbackKind).toBeUndefined()
  })

  it('sanitises unknown enum values', () => {
    const song = mapSong({ ...API_TRACK, source: 'evil', playbackKind: 'telepathy', languageStatus: ' vibes ' })
    expect(song?.source).toBeUndefined() // unknown source is dropped, never 'evil'
    expect(song).not.toHaveProperty('playbackKind')
    expect(song).not.toHaveProperty('languageStatus')
  })

  it('maps albums, artists and playlists defensively', () => {
    expect(mapAlbum({ id: 'jm-album-555', title: 'Open Skies', artistId: 'jm-artist-77', kind: 'album' })?.songIds).toEqual([])
    expect(mapAlbum({ id: 'x', title: 't' })).toBeNull()
    expect(mapArtist({ id: 'jm-artist-77', name: 'Mira Cole' })).toMatchObject({ artworkSeed: 'jm-artist-77' })
    expect(mapArtist({ id: 'x' })).toBeNull()
    expect(mapPlaylist({ id: 'au-playlist-1', title: 'Mix', isUserPlaylist: false })).toMatchObject({ description: '' })
  })

  it('registers remote entities so bylines resolve', () => {
    const grouped = mapGroupedResponse(
      {
        query: 'coastal',
        language: 'fr',
        source: 'jamendo',
        groups: [
          {
            source: 'jamendo',
            name: 'Jamendo',
            status: 'ok',
            results: {
              query: 'coastal',
              songs: [API_TRACK],
              artists: [{ id: 'jm-artist-77', name: 'Mira Cole', artworkSeed: 'jm-artist-77', genreIds: [] }],
              albums: [],
              playlists: [],
            },
          },
        ],
        hiddenSources: ['audius'],
      },
      'coastal',
    )
    expect(grouped?.groups[0]?.results.songs[0]?.id).toBe('jm-song-1848357')
    expect(grouped?.hiddenSources).toEqual(['audius'])
    expect(remoteSong('jm-song-1848357')?.title).toBe('Coastal Light')
    expect(remoteArtist('jm-artist-77')?.name).toBe('Mira Cole')
  })
})

describe('search + track calls', () => {
  it('apiSearchGroup requests one source with the language truth table applied', async () => {
    const { calls } = stubFetch({
      '/api/search': {
        query: 'coastal',
        language: 'fr',
        source: 'jamendo',
        hiddenSources: ['audius'],
        groups: [
          { source: 'jamendo', name: 'Jamendo', status: 'ok', results: { query: 'coastal', songs: [API_TRACK] } },
        ],
      },
    })
    const group = await apiSearchGroup('jamendo', 'coastal', 'fr')
    expect(group.status).toBe('ok')
    expect(group.results.songs[0]?.source).toBe('jamendo')
    const url = new URL(calls[0]!, 'http://localhost')
    expect(url.pathname).toBe('/api/search')
    expect(url.searchParams.get('q')).toBe('coastal')
    expect(url.searchParams.get('source')).toBe('jamendo')
    expect(url.searchParams.get('language')).toBe('fr')
  })

  it('apiSearchGroup throws on a malformed payload (caller falls back)', async () => {
    stubFetch({ '/api/search': { groups: [] } })
    await expect(apiSearchGroup('audius', 'x', 'all')).rejects.toThrow(/Malformed/)
  })

  it('apiGetSong maps the detail and registers entities', async () => {
    stubFetch({
      '/api/tracks/jamendo/jm-song-1848357': {
        track: API_TRACK,
        artists: [{ id: 'jm-artist-77', name: 'Mira Cole', artworkSeed: 'x', genreIds: [] }],
        albums: [],
        playlists: [],
      },
    })
    const song = await apiGetSong('jamendo', 'jm-song-1848357')
    expect(song?.id).toBe('jm-song-1848357')
    expect(remoteArtist('jm-artist-77')?.name).toBe('Mira Cole')
  })

  it('propagates HTTP status so the facade can treat 404 as authoritative', async () => {
    stubFetch({})
    await expect(apiGetSong('audius', 'au-song-nope')).rejects.toMatchObject({ status: 404 })
  })

  it('never sends credentials and only hits configured base URLs', async () => {
    const { calls } = stubFetch({ '/api/health': HEALTH, '/api/search': { groups: [] } })
    await apiAvailable()
    await apiSearchGroup('audius', 'x', 'all').catch(() => undefined)
    for (const call of calls) {
      expect(call).not.toMatch(/AIza|api_key|client_id|secret/i)
    }
  })
})

describe('provider status', () => {
  it('maps /api/providers for the Settings dialog', async () => {
    stubFetch({
      '/api/providers': {
        providers: [
          { id: 'audius', name: 'Audius', description: 'Free', configured: true, status: 'ready' },
          { id: 'jamendo', name: 'Jamendo', description: '', configured: false, status: 'unconfigured' },
          { id: 'broken' },
        ],
      },
    })
    const infos = await fetchServerProviderInfos()
    expect(infos).toHaveLength(2)
    expect(infos?.[0]).toEqual({ id: 'audius', name: 'Audius', description: 'Free', configured: true })
    expect(infos?.[1]?.configured).toBe(false)
  })

  it('returns null when the API is unreachable', async () => {
    stubFetch({})
    expect(await fetchServerProviderInfos()).toBeNull()
  })
})
