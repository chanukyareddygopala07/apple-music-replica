/** Core domain model shared by catalogue providers, engine and UI. */

export interface Genre {
  id: string
  name: string
  /** Two-stop gradient used for generated artwork / category cards. */
  colors: [string, string]
}

export interface Artist {
  id: string
  name: string
  /** Seed string for generated artwork (deterministic). */
  artworkSeed: string
  bio?: string
  genreIds: string[]
}

export type AlbumKind = 'album' | 'ep' | 'single'

export interface Album {
  id: string
  title: string
  artistId: string
  artworkSeed: string
  /** ISO date */
  releaseDate: string
  genreIds: string[]
  kind: AlbumKind
  songIds: string[]
  copyright?: string
  label?: string
  description?: string
}

export interface LyricLine {
  /** ms offset from start of track */
  t: number
  text: string
}

export interface Song {
  id: string
  title: string
  albumId: string
  artistIds: string[]
  durationMs: number
  trackNumber: number
  /** Licensed demo audio URL (SoundHelix) or provider-supplied source. */
  audioUrl: string
  explicit?: boolean
  /** Original demo lyrics when present. */
  lyrics?: LyricLine[]
}

export interface Playlist {
  id: string
  title: string
  description: string
  artworkSeed: string
  songIds: string[]
  /** True for playlists the local user created/edited. */
  isUserPlaylist: boolean
  curator?: string
  createdAt?: number
  updatedAt?: number
}

export interface Station {
  id: string
  name: string
  description: string
  artworkSeed: string
  songIds: string[]
  genreId?: string
}

export interface QueueItem {
  queueItemId: string
  songId: string
}

export type RepeatMode = 'off' | 'all' | 'one'

export type PlaybackStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'ended' | 'error'

export interface RecentlyPlayedEntry {
  songId: string
  at: number
}

export interface SearchResults {
  query: string
  songs: Song[]
  albums: Album[]
  artists: Artist[]
  playlists: Playlist[]
}

/** A horizontal section on the home / browse screens. */
export interface EditorialFeature {
  id: string
  eyebrow: string
  title: string
  subtitle: string
  caption?: string
  artworkSeed: string
  /** Navigation target when the card is activated. */
  href: string
}

export interface HomeFeed {
  features: EditorialFeature[]
  bestNewSongs: Song[]
  newThisWeek: Album[]
  madeForYou: Playlist[]
  topCharts: Song[]
  recentReleases: Album[]
}

export interface BrowseData {
  categories: Genre[]
  newReleases: Album[]
  topCharts: Song[]
  playlists: Playlist[]
}

/** Provider capability flags surfaced in Settings. */
export interface CatalogProviderInfo {
  id: 'demo' | 'musickit'
  name: string
  description: string
  configured: boolean
}

export interface CatalogProvider {
  readonly info: CatalogProviderInfo
  getHome(): Promise<HomeFeed>
  getBrowse(): Promise<BrowseData>
  getStations(): Promise<Station[]>
  getStation(id: string): Promise<Station | null>
  search(query: string): Promise<SearchResults>
  getSong(id: string): Promise<Song | null>
  getAlbum(id: string): Promise<Album | null>
  getArtist(id: string): Promise<Artist | null>
  getPlaylist(id: string): Promise<Playlist | null>
  getGenre(id: string): Promise<Genre | null>
  getSongsByAlbum(albumId: string): Promise<Song[]>
  getAlbumsByArtist(artistId: string): Promise<Album[]>
  getTopSongsByArtist(artistId: string): Promise<Song[]>
}
