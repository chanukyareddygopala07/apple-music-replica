import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AudiusClient, type AudiusRawTrack } from '@/data/audius-client'
import { AudiusProvider } from '@/data/audius-provider'
import { clearRemoteEntities, remoteArtist, remotePlaylist, remoteSong } from '@/data/remote-registry'

function http(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => body,
  } as unknown as Response
}

const track: AudiusRawTrack = {
  id: '6RN8l',
  title: 'Harbor Lights',
  duration: 181,
  artwork: { '480x480': 'https://images.audius.co/480.jpg' },
  user: { id: 'd08dP', name: 'Ada', handle: 'ada' },
  is_streamable: true,
}

const otherTrack: AudiusRawTrack = {
  id: 'J5NMd',
  title: 'Drift',
  duration: 200,
  user: { id: 'u2', name: 'Bo' },
}

/** URL-routed fixture server: no live network, real client+provider code paths. */
function fixtureFetch(routes: Record<string, unknown>, calls: string[] = []) {
  const fn = vi.fn(async (input: string) => {
    calls.push(input)
    const url = new URL(input)
    for (const [pattern, body] of Object.entries(routes)) {
      if (url.pathname.endsWith(pattern)) return http(body)
    }
    return http({}, 404)
  })
  return { fn, calls }
}

function providerWith(routes: Record<string, unknown>): { provider: AudiusProvider; calls: string[] } {
  const { fn, calls } = fixtureFetch(routes)
  const client = new AudiusClient({ fetchFn: fn as never, minGapMs: 0, sleep: async () => {} })
  return { provider: new AudiusProvider(client, { enabled: true, apiKey: '' }), calls }
}

beforeEach(() => clearRemoteEntities())
afterEach(() => clearRemoteEntities())

describe('AudiusProvider.search', () => {
  it('maps tracks, artists and playlists; registers them for sync UI lookups', async () => {
    const { provider } = providerWith({
      '/tracks/search': { data: [track] },
      '/users/search': { data: [{ id: 'd08dP', name: 'Ada' }] },
      '/playlists/search': { data: [{ id: 'Dv9QV', playlist_name: 'Chill' }] },
    })
    const res = await provider.search('harbor')
    expect(res.songs[0]).toMatchObject({
      id: 'au-song-6RN8l',
      title: 'Harbor Lights',
      audioUrl: 'https://api.audius.co/v1/tracks/6RN8l/stream',
      artworkUrl: 'https://images.audius.co/480.jpg',
    })
    expect(res.artists[0]).toMatchObject({ id: 'au-artist-d08dP', name: 'Ada' })
    expect(res.playlists[0]).toMatchObject({ id: 'au-playlist-Dv9QV', title: 'Chill' })
    expect(res.albums).toEqual([])
    // Registry is what songById/artistName/editorialPlaylistById read.
    expect(remoteSong('au-song-6RN8l')?.title).toBe('Harbor Lights')
    expect(remoteArtist('au-artist-d08dP')?.name).toBe('Ada')
    expect(remotePlaylist('au-playlist-Dv9QV')?.title).toBe('Chill')
  })

  it('makes no requests for an empty query', async () => {
    const { provider, calls } = providerWith({})
    const res = await provider.search('   ')
    expect(res.songs).toEqual([])
    expect(calls).toEqual([])
  })

  it('throws when the tracks search fails (facade then falls back to demo)', async () => {
    const fetchFn = vi.fn().mockResolvedValue(http({}, 500))
    const client = new AudiusClient({ fetchFn: fetchFn as never, minGapMs: 0 })
    const provider = new AudiusProvider(client, { enabled: true, apiKey: '' })
    await expect(provider.search('anything')).rejects.toMatchObject({ code: 'http' })
  })

  it('degrades artists/playlists to empty when only those searches fail', async () => {
    const fetchFn = vi.fn(async (input: string) => {
      if (input.includes('/tracks/search')) return http({ data: [track] })
      return http({}, 500)
    })
    const client = new AudiusClient({ fetchFn: fetchFn as never, minGapMs: 0 })
    const provider = new AudiusProvider(client, { enabled: true, apiKey: '' })
    const res = await provider.search('harbor')
    expect(res.songs).toHaveLength(1)
    expect(res.artists.map((a) => a.id)).toEqual(['au-artist-d08dP']) // from track.user
    expect(res.playlists).toEqual([])
  })

  it('filters unplayable tracks out of results', async () => {
    const { provider } = providerWith({
      '/tracks/search': { data: [track, { ...otherTrack, is_stream_gated: true }] },
      '/users/search': { data: [] },
      '/playlists/search': { data: [] },
    })
    const res = await provider.search('x')
    expect(res.songs.map((s) => s.id)).toEqual(['au-song-6RN8l'])
  })
})

describe('AudiusProvider entities', () => {
  it('getSong maps a track and registers its artist + synth album', async () => {
    const { provider } = providerWith({ '/tracks/6RN8l': { data: [track] } })
    const song = await provider.getSong('au-song-6RN8l')
    expect(song).toMatchObject({ id: 'au-song-6RN8l', artistIds: ['au-artist-d08dP'] })
    expect(remoteArtist('au-artist-d08dP')?.name).toBe('Ada')
    expect(await provider.getSong('s-mg-1')).toBeNull() // demo id → not routed here
  })

  it('getPlaylist warms the track cache: resolving its songs costs zero fetches', async () => {
    const playlist = {
      id: 'Dv9QV',
      playlist_name: 'MONKEYS CHILL',
      playlist_contents: [{ track_id: '6RN8l' }],
      tracks: [track],
      user: { id: 'u9', name: 'SMB' },
    }
    const { provider, calls } = providerWith({ '/playlists/Dv9QV': { data: [playlist] } })
    const pl = await provider.getPlaylist('au-playlist-Dv9QV')
    expect(pl).toMatchObject({ id: 'au-playlist-Dv9QV', songIds: ['au-song-6RN8l'], curator: 'SMB' })
    expect(remoteSong('au-song-6RN8l')).toBeTruthy() // embedded tracks registered
    const before = calls.length
    const song = await provider.getSong('au-song-6RN8l') // cache hit — no request
    expect(song?.title).toBe('Harbor Lights')
    expect(calls.length).toBe(before)
  })

  it('getAlbum resolves the synthesised single-track album', async () => {
    const { provider } = providerWith({ '/tracks/6RN8l': { data: [track] } })
    const album = await provider.getAlbum('au-album-t-6RN8l')
    expect(album).toMatchObject({ id: 'au-album-t-6RN8l', kind: 'single', songIds: ['au-song-6RN8l'] })
    const songs = await provider.getSongsByAlbum('au-album-t-6RN8l')
    expect(songs.map((s) => s.id)).toEqual(['au-song-6RN8l'])
  })

  it('artist endpoints map top songs and is_album playlists', async () => {
    const { provider } = providerWith({
      '/users/d08dP': { data: { id: 'd08dP', name: 'Ada', bio: 'hi' } },
      '/users/d08dP/tracks': { data: [track] },
      '/users/d08dP/albums': {
        data: [
          { id: 'Pl1', playlist_name: 'LP One', is_album: true, playlist_contents: [{ track_id: '6RN8l' }] },
          { id: 'Pl2', playlist_name: 'Not An Album', is_album: false },
        ],
      },
    })
    const artist = await provider.getArtist('au-artist-d08dP')
    expect(artist).toMatchObject({ id: 'au-artist-d08dP', name: 'Ada', bio: 'hi' })
    const top = await provider.getTopSongsByArtist('au-artist-d08dP')
    expect(top.map((s) => s.id)).toEqual(['au-song-6RN8l'])
    const albums = await provider.getAlbumsByArtist('au-artist-d08dP')
    expect(albums.map((a) => a.id)).toEqual(['au-album-p-Pl1'])
  })

  it('home/browse map charts; stations/genres are explicitly empty (unsupported)', async () => {
    const { provider } = providerWith({
      '/tracks/trending/underground': { data: [otherTrack] },
      '/tracks/trending': { data: [track] },
      '/playlists/trending': { data: [{ id: 'Tp1', playlist_name: 'Top Mix' }] },
    })
    const home = await provider.getHome()
    expect(home.bestNewSongs.map((s) => s.id)).toEqual(['au-song-J5NMd'])
    expect(home.topCharts.map((s) => s.id)).toEqual(['au-song-6RN8l'])
    expect(home.madeForYou.map((p) => p.id)).toEqual(['au-playlist-Tp1'])
    expect(home.features).toEqual([])

    const browse = await provider.getBrowse()
    expect(browse.topCharts).toHaveLength(1)
    expect(browse.categories).toEqual([])

    expect(await provider.getStations()).toEqual([])
    expect(await provider.getStation('st-1')).toBeNull()
    expect(await provider.getGenre('g-rock')).toBeNull()
  })

  it('exposes audius provider info', () => {
    const { provider } = providerWith({})
    expect(provider.info).toMatchObject({ id: 'audius', name: 'Audius', configured: true })
  })
})
