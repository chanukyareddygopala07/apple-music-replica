import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Song } from '@/domain/types'
import { PlayerEngine } from '@/engine/player'
import { renderLyrics } from '@/ui/lyrics'
import { clearLyricsCache } from '@/data/lyrics-source'
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

const EMBEDDED: Song = {
  id: 'demo-song-lyr',
  title: 'Harbor Lights',
  albumId: 'demo-album-1',
  artistIds: ['demo-artist-1'],
  durationMs: 200_000,
  trackNumber: 1,
  audioUrl: 'https://example.com/d.mp3',
  lyrics: [{ t: 0, text: 'First line' }],
}

const REMOTE: Song = {
  id: 'jm-song-1848357',
  title: 'Coastal Light',
  albumId: 'jm-album-555',
  artistIds: ['jm-artist-77'],
  durationMs: 180_000,
  trackNumber: 1,
  audioUrl: 'https://example.com/r.mp3',
}

let container: HTMLDivElement
let dispose: (() => void) | null = null

async function flush(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

beforeEach(() => {
  HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined) as unknown as typeof HTMLMediaElement.prototype.play
  HTMLMediaElement.prototype.load = vi.fn() as unknown as typeof HTMLMediaElement.prototype.load
  HTMLMediaElement.prototype.pause = vi.fn() as unknown as typeof HTMLMediaElement.prototype.pause
  // jsdom has no layout: the panel scrolls the active line into view.
  Element.prototype.scrollIntoView = vi.fn() as unknown as typeof Element.prototype.scrollIntoView
  container = document.createElement('div')
  document.body.appendChild(container)
  clearLyricsCache()
  clearRemoteEntities()
  resetApiProbe()
  vi.stubEnv('VITE_API_ENABLED', '1')
  // After the registry reset above: both fixtures resolve via songById.
  registerRemoteEntities({ songs: [EMBEDDED, REMOTE] })
})

afterEach(() => {
  dispose?.()
  dispose = null
  container.remove()
  clearRemoteEntities()
  clearLyricsCache()
  resetApiProbe()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('lyrics panel', () => {
  it('renders embedded originals synchronously without any lookup', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const player = new PlayerEngine()
    dispose = renderLyrics(container, player)
    player.playQueue([EMBEDDED])
    await flush()
    expect(container.textContent).toContain('First line')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('looks up remote lyrics once and renders them with LRCLIB attribution', async () => {
    registerRemoteEntities({
      songs: [REMOTE],
      artists: [{ id: 'jm-artist-77', name: 'Mira Cole', artworkSeed: 'x', genreIds: [] }],
      albums: [{ id: 'jm-album-555', title: 'Open Skies', artistId: 'jm-artist-77', artworkSeed: 'x', kind: 'album', releaseDate: '', genreIds: [], songIds: [] }],
    })
    const fetchSpy = vi.fn(async () =>
      http({
        found: true,
        source: 'lrclib',
        instrumental: false,
        syncedLyrics: '[00:01.00] Coastal line one\n[00:04.00] Coastal line two\n',
        attributionName: 'LRCLIB',
        attributionUrl: 'https://lrclib.net',
      }),
    )
    vi.stubGlobal('fetch', fetchSpy)

    const player = new PlayerEngine()
    dispose = renderLyrics(container, player)
    player.playQueue([REMOTE])
    await vi.waitFor(() => expect(container.textContent).toContain('Coastal line one'))
    const link = container.querySelector<HTMLAnchorElement>('.lyrics-attribution a')
    expect(link?.href).toBe('https://lrclib.net/')
    expect(link?.textContent).toBe('LRCLIB')
    expect(fetchSpy).toHaveBeenCalledTimes(1)

    // A later snapshot must not re-fetch (session cache).
    player.playQueue([REMOTE], 0)
    await flush()
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('shows the honest empty state on a miss', async () => {
    registerRemoteEntities({
      songs: [REMOTE],
      artists: [{ id: 'jm-artist-77', name: 'Mira Cole', artworkSeed: 'x', genreIds: [] }],
      albums: [{ id: 'jm-album-555', title: 'Open Skies', artistId: 'jm-artist-77', artworkSeed: 'x', kind: 'album', releaseDate: '', genreIds: [], songIds: [] }],
    })
    vi.stubGlobal('fetch', vi.fn(async () => http({ found: false, source: 'lrclib' })))
    const player = new PlayerEngine()
    dispose = renderLyrics(container, player)
    player.playQueue([REMOTE])
    await vi.waitFor(() => expect(container.textContent).toContain('No lyrics available'))
  })

  it('marks instrumental tracks instead of pretending lyrics exist', async () => {
    registerRemoteEntities({
      songs: [REMOTE],
      artists: [{ id: 'jm-artist-77', name: 'Mira Cole', artworkSeed: 'x', genreIds: [] }],
      albums: [{ id: 'jm-album-555', title: 'Open Skies', artistId: 'jm-artist-77', artworkSeed: 'x', kind: 'album', releaseDate: '', genreIds: [], songIds: [] }],
    })
    vi.stubGlobal('fetch', vi.fn(async () => http({ found: true, source: 'lrclib', instrumental: true })))
    const player = new PlayerEngine()
    dispose = renderLyrics(container, player)
    player.playQueue([REMOTE])
    await vi.waitFor(() => expect(container.textContent).toContain('Instrumental'))
  })
})
