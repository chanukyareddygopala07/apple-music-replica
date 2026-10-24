/**
 * Jamendo catalogue provider — free, Creative Commons catalogue.
 *
 * Maps the free Jamendo read API (https://api.jamendo.com/v3.0) onto the
 * app's CatalogProvider contract. Used by the catalogue facade's *grouped*
 * search (data/catalog.ts), which isolates every source: a Jamendo failure
 * only marks the Jamendo group as an error, never the whole search.
 *
 * Supported: track search (with the documented `lang` lyrics-language
 * filter), track/album/artist pages, an artist's top songs and albums, real
 * streaming URLs from the documented `audio` field (the existing <audio>
 * engine plays them unchanged), Creative Commons attribution
 * (`license_ccurl` → song attribution).
 * Unsupported (documented, never invented): editorial home/browse features,
 * stations, genre pages, lyrics, time-synced anything, ratings.
 * Every entity is registered in the remote registry so the UI's synchronous
 * lookups (songById, artistName, albumById, …) resolve for Jamendo rows too.
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
import { JamendoClient, type JamendoRawTrack } from '@/data/jamendo-client'
import {
  describeJamendoConfig,
  isJamendoConfigured,
  readJamendoConfig,
  type JamendoConfig,
} from '@/data/jamendo-config'
import {
  JM_ALBUM,
  JM_ALBUM_SINGLE,
  JM_ARTIST,
  JM_SONG,
  albumFromTrack,
  jamendoRawId,
  singleAlbumFromTrack,
  toJamendoAlbum,
  toJamendoArtist,
  toJamendoArtistFromRaw,
  toJamendoSong,
} from '@/data/jamendo-normalize'
import { registerRemoteEntities } from '@/data/remote-registry'
import { jamendoLanguage } from '@/data/languages'

export { isJamendoConfigured }

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

export interface JamendoSearchPage {
  results: SearchResults
  /** Opaque next-page cursor (stringified offset); absent = no more pages. */
  cursor?: string
}

export class JamendoProvider implements CatalogProvider {
  readonly info: CatalogProviderInfo
  private readonly client: JamendoClient

  constructor(client?: JamendoClient, config: JamendoConfig = readJamendoConfig()) {
    this.client = client ?? new JamendoClient({ clientId: config.clientId })
    this.info = {
      id: 'jamendo',
      name: 'Jamendo',
      description: describeJamendoConfig(config),
      configured: isJamendoConfigured(config),
    }
  }

  /** Normalise + register tracks with their artists and albums. */
  private rememberTracks(raws: Array<JamendoRawTrack | null | undefined>): Song[] {
    const songs: Song[] = []
    const artists: Artist[] = []
    const albums: Album[] = []
    const artistIds = new Set<string>()
    const albumIds = new Set<string>()
    for (const raw of raws) {
      if (!raw) continue
      const song = toJamendoSong(raw)
      if (!song) continue
      songs.push(song)
      const artist = toJamendoArtist(raw)
      if (artist && !artistIds.has(artist.id)) {
        artistIds.add(artist.id)
        artists.push(artist)
      }
      const album = str(raw.album_id) ? albumFromTrack(raw) : singleAlbumFromTrack(raw)
      if (album && (album.kind !== 'album' || !albumIds.has(album.id))) {
        if (album.kind === 'album') albumIds.add(album.id)
        albums.push(album)
      }
    }
    registerRemoteEntities({ songs, artists, albums })
    return songs
  }

  /**
   * Grouped-search entry: page + optional language filter. `cursor` is the
   * previous page's offset (opaque to callers). The app-level language code
   * is mapped to Jamendo's documented 2-letter `lang` value here — callers
   * must have gated on `sourceSupportsLanguage('jamendo', language)` (the
   * facade does), so an unrepresentable code never reaches this point.
   */
  async searchPage(
    query: string,
    opts: { language?: string; cursor?: string; limit?: number } = {},
  ): Promise<JamendoSearchPage> {
    const q = query.trim()
    if (!q) return { results: EMPTY_RESULTS(query) }
    const limit = opts.limit ?? 10
    const offsetRaw = Number(opts.cursor ?? 0)
    const offset = Number.isFinite(offsetRaw) && offsetRaw > 0 ? Math.floor(offsetRaw) : 0

    const raws = await this.client.searchTracks({
      query: q,
      // `all`/absent → undefined → no restrictive `lang` parameter at all.
      language: opts.language ? jamendoLanguage(opts.language) : undefined,
      limit,
      offset,
    })
    const songs = this.rememberTracks(raws)
    const artists: Artist[] = []
    const albums: Album[] = []
    const seenArtists = new Set<string>()
    const seenAlbums = new Set<string>()
    for (const raw of raws) {
      const artist = toJamendoArtist(raw)
      if (artist && !seenArtists.has(artist.id)) {
        seenArtists.add(artist.id)
        artists.push(artist)
      }
      const album = albumFromTrack(raw)
      if (album && !seenAlbums.has(album.id)) {
        seenAlbums.add(album.id)
        albums.push(album)
      }
    }
    registerRemoteEntities({ artists, albums })
    const full = raws.length >= limit
    return {
      results: { query, songs, albums, artists, playlists: [] },
      cursor: full ? String(offset + limit) : undefined,
    }
  }

  /** CatalogProvider.search — no language filter (the facade uses searchPage). */
  async search(query: string): Promise<SearchResults> {
    const page = await this.searchPage(query)
    return page.results
  }

  async getHome(): Promise<HomeFeed> {
    return EMPTY_FEED
  }

  async getBrowse(): Promise<BrowseData> {
    return EMPTY_BROWSE
  }

  async getStations(): Promise<Station[]> {
    return []
  }

  async getStation(): Promise<Station | null> {
    return null
  }

  async getSong(id: string): Promise<Song | null> {
    const rawId = jamendoRawId(id, JM_SONG)
    if (!rawId) return null
    const raws = await this.client.searchTracks({ id: rawId, limit: 1 })
    const songs = this.rememberTracks(raws)
    return songs[0] ?? null
  }

  async getAlbum(id: string): Promise<Album | null> {
    // Single-album ids (`jm-album-t-*`) begin with the album prefix — they
    // must be unwrapped first or they misroute into the real-album path.
    const trackId = jamendoRawId(id, JM_ALBUM_SINGLE)
    if (trackId) {
      const raws = await this.client.searchTracks({ id: trackId, limit: 1 })
      const raw = raws[0]
      this.rememberTracks(raws)
      return singleAlbumFromTrack(raw)
    }
    const albumId = jamendoRawId(id, JM_ALBUM)
    if (albumId) {
      const raws = await this.client.getAlbum(albumId)
      const album = toJamendoAlbum(raws[0])
      if (album) {
        album.songIds = (await this.getSongsByAlbum(id)).map((s) => s.id)
        registerRemoteEntities({ albums: [album] })
      }
      return album
    }
    return null
  }

  async getArtist(id: string): Promise<Artist | null> {
    const rawId = jamendoRawId(id, JM_ARTIST)
    if (!rawId) return null
    const raws = await this.client.getArtist(rawId)
    const artist = toJamendoArtistFromRaw(raws[0])
    if (artist) registerRemoteEntities({ artists: [artist] })
    return artist
  }

  async getPlaylist(_id: string): Promise<Playlist | null> {
    return null
  }

  async getGenre(_id: string): Promise<Genre | null> {
    return null
  }

  async getSongsByAlbum(albumId: string): Promise<Song[]> {
    // Single-album ids first — see getAlbum (prefix overlap).
    const trackId = jamendoRawId(albumId, JM_ALBUM_SINGLE)
    if (trackId) {
      const song = await this.getSong(`${JM_SONG}${trackId}`)
      return song ? [song] : []
    }
    const rawId = jamendoRawId(albumId, JM_ALBUM)
    if (rawId) {
      const raws = await this.client.searchTracks({ albumId: rawId, limit: 50 })
      return this.rememberTracks(raws)
    }
    return []
  }

  async getAlbumsByArtist(artistId: string): Promise<Album[]> {
    const rawId = jamendoRawId(artistId, JM_ARTIST)
    if (!rawId) return []
    const raws = await this.client.albumsByArtist(rawId, 12)
    const albums = raws.map((raw) => toJamendoAlbum(raw)).filter((a): a is Album => Boolean(a))
    registerRemoteEntities({ albums })
    return albums
  }

  async getTopSongsByArtist(artistId: string): Promise<Song[]> {
    const rawId = jamendoRawId(artistId, JM_ARTIST)
    if (!rawId) return []
    const raws = await this.client.searchTracks({ artistId: rawId, limit: 8 })
    return this.rememberTracks(raws)
  }
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}
