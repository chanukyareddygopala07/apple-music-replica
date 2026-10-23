/**
 * Audius catalogue provider — the primary external provider.
 *
 * Maps the free public Audius REST API (https://api.audius.co) onto the
 * app's CatalogProvider contract. Called by the catalogue facade, which
 * falls back to the demo provider on any failure (see data/catalog.ts).
 *
 * Every entity returned is registered in the remote registry so the UI's
 * synchronous lookups (songById, artistName, albumById, …) resolve for
 * remote rows too.
 *
 * Supported: search (tracks/users/playlists), track/artist/playlist/album
 * details, artist top songs and albums, trending + underground charts,
 * real streaming URLs (<audio> follows the 302 redirect, Range supported).
 * Unsupported (documented in data/audius-normalize.ts): editorial features,
 * stations, genre pages, lyrics, ratings, dedicated album search.
 */

import type {
  Album,
  Artist,
  BrowseData,
  CatalogProvider,
  CatalogProviderInfo,
  Genre,
  HomeFeed,
  Playlist,
  SearchResults,
  Song,
  Station,
} from '@/domain/types'
import { AudiusClient, type AudiusRawPlaylist, type AudiusRawTrack, type AudiusRawUser } from '@/data/audius-client'
import {
  describeAudiusConfig,
  isAudiusConfigured,
  readAudiusConfig,
  type AudiusConfig,
} from '@/data/audius-config'
import {
  AU_ALBUM_PLAYLIST,
  AU_ALBUM_TRACK,
  AU_ARTIST,
  AU_PLAYLIST,
  AU_SONG,
  albumFromPlaylist,
  albumFromTrack,
  audiusRawId,
  playlistContentIds,
  toArtist,
  toPlaylist,
  toSong,
} from '@/data/audius-normalize'
import { registerRemoteEntities } from '@/data/remote-registry'

export { isAudiusConfigured }

const EMPTY_RESULTS = (query: string): SearchResults => ({
  query,
  songs: [],
  albums: [],
  artists: [],
  playlists: [],
})

const EMPTY_FEED: HomeFeed = {
  features: [],
  bestNewSongs: [],
  newThisWeek: [],
  madeForYou: [],
  topCharts: [],
  recentReleases: [],
}

const EMPTY_BROWSE: BrowseData = {
  categories: [],
  newReleases: [],
  topCharts: [],
  playlists: [],
}

export class AudiusProvider implements CatalogProvider {
  readonly info: CatalogProviderInfo
  private readonly client: AudiusClient

  constructor(client?: AudiusClient, config: AudiusConfig = readAudiusConfig()) {
    this.client = client ?? new AudiusClient({ apiKey: config.apiKey })
    this.info = {
      id: 'audius',
      name: 'Audius',
      description: describeAudiusConfig(config),
      configured: config.enabled,
    }
  }

  /** Domain Song with the streaming endpoint attached as audioUrl. */
  private song(raw: AudiusRawTrack | null | undefined): Song | null {
    const song = toSong(raw)
    if (!song || !raw?.id) return null
    song.audioUrl = this.client.streamUrl(raw.id)
    return song
  }

  /** Normalise + register tracks with their artists and synth albums. */
  private rememberTracks(raws: Array<AudiusRawTrack | null | undefined>): Song[] {
    const songs: Song[] = []
    const artists: Artist[] = []
    const albums: Album[] = []
    for (const raw of raws) {
      if (!raw) continue
      const song = this.song(raw)
      if (!song) continue
      songs.push(song)
      const artist = toArtist(raw.user)
      if (artist) artists.push(artist)
      const album = albumFromTrack(raw)
      if (album) albums.push(album)
    }
    registerRemoteEntities({ songs, artists, albums })
    return songs
  }

  private rememberUsers(raws: Array<AudiusRawUser | null | undefined>): Artist[] {
    const artists = raws
      .map((raw) => toArtist(raw))
      .filter((a): a is Artist => Boolean(a))
    registerRemoteEntities({ artists })
    return artists
  }

  private rememberPlaylists(raws: Array<AudiusRawPlaylist | null | undefined>): Playlist[] {
    const playlists = raws
      .map((raw) => toPlaylist(raw))
      .filter((p): p is Playlist => Boolean(p))
    registerRemoteEntities({ playlists })
    return playlists
  }

  async search(query: string): Promise<SearchResults> {
    const q = query.trim()
    if (!q) return EMPTY_RESULTS(query)
    // Tracks are the core of the result — if that request fails the facade
    // falls back to the demo catalogue entirely. Users/playlists degrade to
    // their empty groups so a partial outage still yields playable songs.
    const [trackRaws, userRaws, playlistRaws] = await Promise.all([
      this.client.searchTracks(q, 20),
      this.client.searchUsers(q, 8).catch(() => [] as AudiusRawUser[]),
      this.client.searchPlaylists(q, 8).catch(() => [] as AudiusRawPlaylist[]),
    ])
    const songs = this.rememberTracks(trackRaws)
    const fromUsers = this.rememberUsers(userRaws)
    const seen = new Set(fromUsers.map((a) => a.id))
    const trackArtists = this.rememberUsers(
      trackRaws
        .map((raw) => raw.user)
        .filter((u): u is AudiusRawUser => u != null && !seen.has(`${AU_ARTIST}${u.id}`)),
    )
    const playlists = this.rememberPlaylists(playlistRaws)
    return {
      query,
      songs,
      albums: [],
      artists: [...fromUsers, ...trackArtists].slice(0, 12),
      playlists,
    }
  }

  async getHome(): Promise<HomeFeed> {
    const [trending, underground, playlistRaws] = await Promise.all([
      this.client.trendingTracks(20),
      this.client.undergroundTracks(12).catch(() => [] as AudiusRawTrack[]),
      this.client.trendingPlaylists(6).catch(() => [] as AudiusRawPlaylist[]),
    ])
    const chartSongs = this.rememberTracks(trending)
    const freshSongs = underground.length ? this.rememberTracks(underground) : chartSongs.slice(0, 12)
    const madeForYou = this.rememberPlaylists(playlistRaws)
    return {
      ...EMPTY_FEED,
      bestNewSongs: freshSongs.slice(0, 12),
      topCharts: chartSongs.slice(0, 14),
      madeForYou,
    }
  }

  async getBrowse(): Promise<BrowseData> {
    const [trending, playlistRaws] = await Promise.all([
      this.client.trendingTracks(12),
      this.client.trendingPlaylists(8).catch(() => [] as AudiusRawPlaylist[]),
    ])
    return {
      ...EMPTY_BROWSE,
      topCharts: this.rememberTracks(trending),
      playlists: this.rememberPlaylists(playlistRaws),
    }
  }

  async getStations(): Promise<Station[]> {
    return []
  }

  async getStation(_id: string): Promise<Station | null> {
    return null
  }

  async getSong(id: string): Promise<Song | null> {
    const rawId = audiusRawId(id, AU_SONG)
    if (!rawId) return null
    const raw = await this.client.getTrack(rawId)
    const songs = this.rememberTracks([raw])
    return songs[0] ?? null
  }

  async getAlbum(id: string): Promise<Album | null> {
    const trackId = audiusRawId(id, AU_ALBUM_TRACK)
    if (trackId) {
      const raw = await this.client.getTrack(trackId)
      const songs = this.rememberTracks([raw])
      const album = albumFromTrack(raw)
      const first = songs[0]
      if (album && first) album.songIds = [first.id]
      return album
    }
    const playlistId = audiusRawId(id, AU_ALBUM_PLAYLIST)
    if (playlistId) {
      const raw = await this.client.getPlaylist(playlistId)
      if (raw?.tracks?.length) {
        this.client.warmTrackCache(raw.tracks)
        this.rememberTracks(raw.tracks)
      }
      return albumFromPlaylist(raw)
    }
    return null
  }

  async getArtist(id: string): Promise<Artist | null> {
    const rawId = audiusRawId(id, AU_ARTIST)
    if (!rawId) return null
    const raw = await this.client.getUser(rawId)
    const [artist] = this.rememberUsers([raw])
    return artist ?? null
  }

  async getPlaylist(id: string): Promise<Playlist | null> {
    const rawId = audiusRawId(id, AU_PLAYLIST)
    if (!rawId) return null
    const raw = await this.client.getPlaylist(rawId)
    if (!raw) return null
    if (raw.tracks?.length) {
      // Warm the per-track cache: the playlist view resolves its song rows
      // through getSong(), which then costs zero additional requests.
      this.client.warmTrackCache(raw.tracks)
      this.rememberTracks(raw.tracks)
    }
    return this.rememberPlaylists([raw])[0] ?? null
  }

  async getGenre(_id: string): Promise<Genre | null> {
    return null
  }

  async getSongsByAlbum(albumId: string): Promise<Song[]> {
    const trackId = audiusRawId(albumId, AU_ALBUM_TRACK)
    if (trackId) {
      const raw = await this.client.getTrack(trackId)
      return this.rememberTracks([raw])
    }
    const playlistId = audiusRawId(albumId, AU_ALBUM_PLAYLIST)
    if (playlistId) {
      const raw = await this.client.getPlaylist(playlistId)
      if (raw?.tracks?.length) {
        this.client.warmTrackCache(raw.tracks)
        return this.rememberTracks(raw.tracks)
      }
      const ids = playlistContentIds(raw)
      const resolved = await Promise.all(ids.map((id) => this.getSong(id)))
      return resolved.filter((s): s is Song => Boolean(s))
    }
    return []
  }

  async getAlbumsByArtist(artistId: string): Promise<Album[]> {
    const rawId = audiusRawId(artistId, AU_ARTIST)
    if (!rawId) return []
    const raws = await this.client.userAlbums(rawId, 12)
    const albums: Album[] = []
    for (const raw of raws) {
      if (raw.is_album === false) continue
      const album = albumFromPlaylist(raw)
      if (album) albums.push(album)
    }
    registerRemoteEntities({ albums })
    return albums
  }

  async getTopSongsByArtist(artistId: string): Promise<Song[]> {
    const rawId = audiusRawId(artistId, AU_ARTIST)
    if (!rawId) return []
    const raws = await this.client.userTracks(rawId, 8)
    return this.rememberTracks(raws)
  }
}
