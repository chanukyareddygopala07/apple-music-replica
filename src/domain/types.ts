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
  /** Remote artwork URL when the provider supplies one (Audius); otherwise
   * UI falls back to generated art from `album-{albumId}`. */
  artworkUrl?: string
  /** Catalogue source that produced this song (source badges + routing). */
  source?: CatalogSource
  /** How the song plays: through the <audio> engine (default) or the
   * visible official YouTube embed. YouTube results never play silently. */
  playbackKind?: PlaybackKind
  /** Canonical page on the source site (e.g. the YouTube watch URL). */
  externalUrl?: string
  /** Attribution label + link for CC-sourced results (Jamendo). */
  attribution?: string
  attributionUrl?: string
  /** App-level language code of the track (`en`, `zh-Hans`, …) when the
   * provider states one. Absent = unknown: the track is eligible under every
   * language filter (it cannot honestly be excluded). */
  language?: string
  /** How `language` was determined. Absent = unknown. */
  languageStatus?: 'verified' | 'inferred' | 'unknown'
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

/** A concrete catalogue source (the `source` search selector). */
export type CatalogSource = 'demo' | 'audius' | 'jamendo' | 'youtube' | 'musickit'

/** The `source` selector value: a source, or `all` for every source. */
export type SourceFilter = CatalogSource | 'all'

/** Playback transport for a song (audio engine vs. visible video embed). */
export type PlaybackKind = 'audio' | 'youtube'

/** Per-source search outcome; `empty` renders as a hidden group. */
export type SearchGroupStatus = 'ok' | 'empty' | 'error' | 'unconfigured' | 'disabled'

/** One source's slice of a search, kept separate from every other source. */
export interface SearchGroup {
  source: CatalogSource
  /** Display name shown on the group header + badge. */
  name: string
  status: SearchGroupStatus
  /** Human-readable note for error/unconfigured/disabled groups. */
  message?: string
  results: SearchResults
  /** Opaque cursor for the next page of this group (offset / page token). */
  cursor?: string
}

/** Search options: language + source selectors (defaults `all` / `all`). */
export interface SearchQueryOptions {
  language?: string
  source?: SourceFilter
  /** Cancels superseded searches (stale keystrokes) — see data/api-client. */
  signal?: AbortSignal
}

/** Grouped search: results partitioned per source, never merged. */
export interface GroupedSearchResults {
  query: string
  /** Normalised language code actually applied (`all` = none). */
  language: string
  source: SourceFilter
  /** Groups in canonical source order (only eligible sources). */
  groups: SearchGroup[]
  /** Eligible sources dropped because they cannot filter by `language`. */
  hiddenSources: CatalogSource[]
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
  id: 'demo' | 'musickit' | 'audius' | 'jamendo' | 'youtube'
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
