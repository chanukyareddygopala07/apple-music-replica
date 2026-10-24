/**
 * YouTube discovery provider — search only, playback via the official embed.
 *
 * Maps the YouTube Data API v3 (`search.list` + `videos.list`) onto the
 * app's CatalogProvider contract for the catalogue facade's *grouped*
 * search (data/catalog.ts): a YouTube failure marks only the YouTube group
 * as an error, never the whole search.
 *
 * Scope (documented, never invented): song results only — no channel/album
 * search lists, no editorial feeds, no hidden audio. Every song is
 * `playbackKind: 'youtube'`, so rows open the visible official IFrame embed
 * (/watch) instead of the silent <audio> queue. Entity pages that do exist
 * are cheap: song = videos.list (1 quota unit), album = one video, artist =
 * channels.list (1 unit) + the channel's songs already seen this session
 * (channel search would cost a full search-list call — never spent here).
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
import { YoutubeClient, type YoutubeSearchItem, type YoutubeVideoItem } from '@/data/youtube-client'
import {
  describeYoutubeConfig,
  isYoutubeConfigured,
  readYoutubeConfig,
  type YoutubeConfig,
} from '@/data/youtube-config'
import {
  YT_ARTIST,
  youtubeAlbumFromSong,
  youtubeAlbumVideoId,
  youtubeArtistFromSnippet,
  youtubeChannelId,
  youtubeSongFromVideo,
  youtubeVideoId,
  toYoutubeArtist,
  toYoutubeSong,
} from '@/data/youtube-normalize'
import { registerRemoteEntities, remoteAlbum, remoteArtist, remoteSong } from '@/data/remote-registry'
import { youtubeLanguage } from '@/data/languages'

export { isYoutubeConfigured }

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

export interface YoutubeSearchPage {
  results: SearchResults
  /** Opaque next-page cursor (search.list nextPageToken). */
  cursor?: string
}

export class YoutubeProvider implements CatalogProvider {
  readonly info: CatalogProviderInfo
  private readonly client: YoutubeClient
  private readonly channelSongs = new Map<string, Song[]>()
  private readonly configured: boolean
  /** videos.list `status.madeForKids` by video id (session memory only). */
  private readonly madeForKidsByVideo = new Map<string, boolean | undefined>()

  constructor(client?: YoutubeClient, config: YoutubeConfig = readYoutubeConfig()) {
    this.client = client ?? new YoutubeClient({ apiKey: config.apiKey })
    this.configured = isYoutubeConfigured(config)
    this.info = {
      id: 'youtube',
      name: 'YouTube',
      description: describeYoutubeConfig(config),
      configured: this.configured,
    }
  }

  /**
   * Made-for-kids status from the videos.list lookup (Developer Policies
   * III.E.4.j requires looking this up). `undefined` = unknown (e.g. keyless
   * or the API omitted it) — callers must treat unknown conservatively
   * (privacy-enhanced / nocookie embedding).
   */
  madeForKids(videoId: string): boolean | undefined {
    return this.madeForKidsByVideo.get(videoId)
  }

  private rememberMadeForKids(videos: YoutubeVideoItem[]): void {
    for (const v of videos) {
      if (v.id) this.madeForKidsByVideo.set(v.id, v.status?.madeForKids)
    }
  }

  /** Durations (1 cheap videos.list call); a failure never fails the search. */
  private async withDurations(items: YoutubeSearchItem[]): Promise<number[]> {
    const ids = items.map((i) => i.id?.videoId).filter((id): id is string => Boolean(id))
    if (ids.length === 0) return []
    let videos: YoutubeVideoItem[] = []
    try {
      videos = await this.client.getVideos(ids)
    } catch {
      return []
    }
    this.rememberMadeForKids(videos)
    const byId = new Map(videos.map((v) => [v.id ?? '', v]))
    return ids.map((id) => youtubeSongFromVideo(byId.get(id))?.durationMs ?? 0)
  }

  /** Grouped-search entry: language → relevanceLanguage, cursor → pageToken. */
  async searchPage(
    query: string,
    opts: { language?: string; cursor?: string; limit?: number } = {},
  ): Promise<YoutubeSearchPage> {
    const q = query.trim()
    if (!q || !this.configured) return { results: EMPTY_RESULTS(query) }

    const { items, nextPageToken } = await this.client.searchVideos({
      query: q,
      // Map the app's language codes to ISO-639-1 `relevanceLanguage`
      // (e.g. zh-Hans → zh); a relevance *hint* only, never a verification.
      language: opts.language ? youtubeLanguage(opts.language) : undefined,
      cursor: opts.cursor,
      limit: opts.limit ?? 10,
    })
    const durations = await this.withDurations(items)

    const songs: Song[] = []
    const artists: Artist[] = []
    const seenArtists = new Set<string>()
    items.forEach((item, i) => {
      const song = toYoutubeSong(item, { durationMs: durations[i] ?? 0 })
      if (!song) return
      songs.push(song)
      const channelId = song.artistIds[0]?.slice(YT_ARTIST.length) ?? ''
      const artist = channelId ? toYoutubeArtist(channelId, item.snippet?.channelTitle) : null
      if (!artist) return
      if (!seenArtists.has(artist.id)) {
        seenArtists.add(artist.id)
        artists.push(artist)
      }
      const known = this.channelSongs.get(artist.id)
      if (known) known.push(song)
      else this.channelSongs.set(artist.id, [song])
    })
    // Register names for rows; artists/albums groups stay empty for YouTube
    // (discovery scope is songs — see module header).
    registerRemoteEntities({ songs, artists })
    return {
      results: { query, songs, albums: [], artists: [], playlists: [] },
      cursor: nextPageToken,
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
    const cached = remoteSong(id)
    if (cached) return cached
    if (!this.configured) return null
    const videoId = youtubeVideoId(id)
    if (!videoId) return null
    return this.songFromVideoId(videoId)
  }

  async getAlbum(id: string): Promise<Album | null> {
    const videoId = youtubeAlbumVideoId(id)
    if (!videoId) return null
    const song = await this.songFromVideoId(videoId)
    if (!song) return remoteAlbum(id) ?? null
    // songFromVideoId registered the album (with release date) already.
    return remoteAlbum(id) ?? youtubeAlbumFromSong(song, undefined)
  }

  async getSongsByAlbum(albumId: string): Promise<Song[]> {
    const album = await this.getAlbum(albumId)
    const songId = album?.songIds[0]
    if (!songId) return []
    const song = await this.getSong(songId)
    return song ? [song] : []
  }

  async getArtist(id: string): Promise<Artist | null> {
    const cached = remoteArtist(id)
    if (cached) return cached
    if (!this.configured) return null
    const channelId = youtubeChannelId(id)
    if (!channelId) return null
    try {
      const channels = await this.client.getChannels([channelId])
      // channels.list names the channel in `snippet.title`; search snippets
      // use `channelTitle` — accept either shape so a live call resolves too.
      const channelSnippet = channels[0]?.snippet
      const artist = toYoutubeArtist(channelId, channelSnippet?.title ?? channelSnippet?.channelTitle)
      if (artist) registerRemoteEntities({ artists: [artist] })
      return artist
    } catch {
      return null
    }
  }

  /** Channel songs seen in this session only (channel search never spent). */
  async getTopSongsByArtist(artistId: string): Promise<Song[]> {
    return this.channelSongs.get(artistId) ?? []
  }

  async getAlbumsByArtist(): Promise<Album[]> {
    // YouTube discovery scope is songs only — no channel album lists (never
    // invented; channel search would cost a full search-list quota call).
    return []
  }

  async getPlaylist(): Promise<Playlist | null> {
    return null
  }

  async getGenre(): Promise<Genre | null> {
    return null
  }

  /** videos.list (1 unit) → song + its single album + channel artist. */
  private async songFromVideoId(videoId: string): Promise<Song | null> {
    if (!this.configured) return null
    let video: YoutubeVideoItem | undefined
    try {
      const videos = await this.client.getVideos([videoId])
      this.rememberMadeForKids(videos)
      video = videos[0]
    } catch {
      video = undefined
    }
    const song = youtubeSongFromVideo(video)
    if (!song) return null
    const artistId = song.artistIds[0]
    const artist = artistId
      ? youtubeArtistFromSnippet(artistId.slice(YT_ARTIST.length), video?.snippet)
      : null
    const album = youtubeAlbumFromSong(song, video?.snippet)
    registerRemoteEntities({
      songs: [song],
      ...(artist ? { artists: [artist] } : {}),
      ...(album ? { albums: [album] } : {}),
    })
    if (artist) this.channelSongs.set(artist.id, [song])
    return song
  }
}
