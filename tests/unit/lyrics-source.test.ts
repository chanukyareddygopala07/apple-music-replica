import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Song } from '@/domain/types'
import { clearLyricsCache, parseLrc, resolveLyrics, LRCLIB_NAME, LRCLIB_URL } from '@/data/lyrics-source'
import { resetApiProbe } from '@/data/api-client'
import { clearRemoteEntities, registerRemoteEntities } from '@/data/remote-registry'

function http(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => body,
  } as unknown as Response
}

function stubFetch(body: unknown, status = 200): { calls: string[] } {
  const calls: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      calls.push(input)
      return http(body, status)
    }),
  )
  return { calls }
}

const REMOTE_SONG: Song = {
  id: 'jm-song-1848357',
  title: 'Coastal Light',
  albumId: 'jm-album-555',
  artistIds: ['jm-artist-77'],
  durationMs: 180_500,
  trackNumber: 1,
  audioUrl: 'https://example.com/x.mp3',
}

const DEMO_SONG: Song = {
  id: 'demo-song-1',
  title: 'Harbor Lights',
  albumId: 'demo-album-1',
  artistIds: ['demo-artist-1'],
  durationMs: 200_000,
  trackNumber: 1,
  audioUrl: 'https://example.com/d.mp3',
  lyrics: [
    { t: 0, text: 'First line' },
    { t: 1_500, text: 'Second line' },
  ],
}

function seedRemote(): void {
  registerRemoteEntities({
    songs: [REMOTE_SONG],
    artists: [{ id: 'jm-artist-77', name: 'Mira Cole', artworkSeed: 'x', genreIds: [] }],
    albums: [{ id: 'jm-album-555', title: 'Open Skies', artistId: 'jm-artist-77', artworkSeed: 'x', kind: 'album', releaseDate: '', genreIds: [], songIds: [] }],
  })
}

beforeEach(() => {
  clearLyricsCache()
  clearRemoteEntities()
  resetApiProbe() // availability is sticky per module — reset between tests
  vi.stubEnv('VITE_API_ENABLED', '1')
})

afterEach(() => {
  clearRemoteEntities()
  clearLyricsCache()
  resetApiProbe()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('parseLrc', () => {
  it('parses timestamps into time-ordered LyricLines', () => {
    const lines = parseLrc('[00:05.50] Second\n[00:01.00] First\n')
    expect(lines).toEqual([
      { t: 1_000, text: 'First' },
      { t: 5_500, text: 'Second' },
    ])
  })

  it('supports long minutes, no-fraction and multiple stamps per line', () => {
    // LRC has no hours field: minutes may exceed 59 (e.g. [62:03.50]).
    const lines = parseLrc('[62:03.50] A\n[00:10] B\n[00:11.5][00:12.25] C\n')
    expect(lines.map((l) => l.t)).toEqual([10_000, 11_500, 12_250, 3_723_500])
    expect(lines.find((l) => l.t === 12_250)?.text).toBe('C')
  })

  it('skips metadata tags and untimed lines', () => {
    expect(parseLrc('[ar:Mira]\n[ti:Open]\njust plain text\n')).toEqual([])
  })
})

describe('resolveLyrics', () => {
  it('prefers embedded originals and never calls the network', async () => {
    const { calls } = stubFetch({})
    const result = await resolveLyrics(DEMO_SONG)
    expect(result?.lines).toEqual(DEMO_SONG.lyrics)
    expect(result?.attributionName).toBeUndefined()
    expect(calls).toEqual([])
  })

  it('looks up remote lyrics with the full signature', async () => {
    seedRemote()
    const { calls } = stubFetch({
      found: true,
      source: 'lrclib',
      instrumental: false,
      plainLyrics: 'Plain line\n',
      syncedLyrics: '[00:01.00] Plain line\n',
      attributionName: LRCLIB_NAME,
      attributionUrl: LRCLIB_URL,
    })
    const result = await resolveLyrics(REMOTE_SONG)
    expect(result?.lines).toEqual([{ t: 1_000, text: 'Plain line' }])
    expect(result?.attributionUrl).toBe(LRCLIB_URL)

    const url = new URL(calls[0]!, 'http://localhost')
    expect(url.pathname).toBe('/api/lyrics')
    expect(url.searchParams.get('track_name')).toBe('Coastal Light')
    expect(url.searchParams.get('artist_name')).toBe('Mira Cole')
    expect(url.searchParams.get('album_name')).toBe('Open Skies')
    expect(url.searchParams.get('duration')).toBe('181') // 180.5s rounds up
  })

  it('remembers a miss so it is looked up only once per session', async () => {
    seedRemote()
    const { calls } = stubFetch({ found: false, source: 'lrclib' })
    expect(await resolveLyrics(REMOTE_SONG)).toBeNull()
    expect(await resolveLyrics(REMOTE_SONG)).toBeNull()
    expect(calls).toHaveLength(1)
  })

  it('falls back to unsynchronised plain lines when no LRC is provided', async () => {
    seedRemote()
    stubFetch({ found: true, source: 'lrclib', plainLyrics: 'One\n\nTwo\n' })
    const result = await resolveLyrics(REMOTE_SONG)
    expect(result?.lines.map((l) => l.text)).toEqual(['One', 'Two'])
    // No timestamps → never highlighted / never seeked.
    expect(result?.lines.every((l) => l.t === Number.POSITIVE_INFINITY)).toBe(true)
  })

  it('reports instrumental tracks honestly', async () => {
    seedRemote()
    stubFetch({ found: true, source: 'lrclib', instrumental: true })
    const result = await resolveLyrics(REMOTE_SONG)
    expect(result?.instrumental).toBe(true)
    expect(result?.lines).toEqual([])
  })

  it('does not call the API when it is disabled for the build', async () => {
    vi.stubEnv('VITE_API_ENABLED', '0')
    seedRemote()
    const { calls } = stubFetch({})
    expect(await resolveLyrics(REMOTE_SONG)).toBeNull()
    expect(calls).toEqual([])
  })

  it('does not cache a transport failure (it may recover)', async () => {
    seedRemote()
    const responses = [
      http({}, 503),
      http({ found: true, source: 'lrclib', syncedLyrics: '[00:01.00] Back\n' }),
    ]
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => responses.shift() ?? http({}, 503)),
    )
    await expect(resolveLyrics(REMOTE_SONG)).rejects.toBeTruthy()
    const recovered = await resolveLyrics(REMOTE_SONG)
    expect(recovered?.lines[0]?.text).toBe('Back')
  })
})
