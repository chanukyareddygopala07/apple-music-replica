/**
 * Client for the Realaxify API (`backend/` — FastAPI) and its domain mapping.
 *
 * The API exists to keep credentials on the server (Jamendo client id,
 * YouTube Data API key, optional Audius key) and to apply the language truth
 * table server-side. Everything it returns is the same domain shape the
 * browser-side providers produce, so the catalogue facade and the UI never
 * learn where a result came from.
 *
 * Availability is decided at runtime, not build time:
 * - `VITE_API_ENABLED=0` — never talk to the API (fully static build).
 * - `VITE_API_ENABLED=1` — use it without probing.
 * - unset (default) — one cheap `GET /api/health` per session; any failure
 *   (static hosting, offline, older deploy) permanently falls back to the
 *   direct browser providers. Nothing about the app depends on the API being
 *   there: it is an enhancement, not a requirement.
 *
 * Safety rules mirrored from the server: no credentials in requests or
 * responses, bounded request timeouts, and a 404 from the API is treated as
 * authoritative (the provider does not know that id) while transport errors
 * fall back to the direct providers.
 */

import type {
  Album,
  Artist,
  CatalogSource,
  CatalogProviderInfo,
  GroupedSearchResults,
  Playlist,
  SearchGroup,
  SearchResults,
  Song,
  SourceFilter,
} from '@/domain/types'
import { registerRemoteEntities } from '@/data/remote-registry'

/** Raw (snake_case-free) shapes the API emits — camelCase on the wire. */
interface ApiTrack {
  id?: unknown
  title?: unknown
  albumId?: unknown
  artistIds?: unknown
  durationMs?: unknown
  trackNumber?: unknown
  audioUrl?: unknown
  explicit?: unknown
  artworkUrl?: unknown
  source?: unknown
  playbackKind?: unknown
  externalUrl?: unknown
  attribution?: unknown
  attributionUrl?: unknown
  language?: unknown
  languageStatus?: unknown
}

interface ApiAlbum {
  id?: unknown
  title?: unknown
  artistId?: unknown
  artworkSeed?: unknown
  releaseDate?: unknown
  genreIds?: unknown
  kind?: unknown
  songIds?: unknown
  copyright?: unknown
  label?: unknown
  description?: unknown
}

interface ApiArtist {
  id?: unknown
  name?: unknown
  artworkSeed?: unknown
  bio?: unknown
  genreIds?: unknown
}

interface ApiPlaylist {
  id?: unknown
  title?: unknown
  description?: unknown
  artworkSeed?: unknown
  songIds?: unknown
  isUserPlaylist?: unknown
  curator?: unknown
  createdAt?: unknown
  updatedAt?: unknown
}

interface ApiResults {
  query?: unknown
  songs?: unknown
  albums?: unknown
  artists?: unknown
  playlists?: unknown
}

interface ApiGroup {
  source?: unknown
  name?: unknown
  status?: unknown
  message?: unknown
  results?: unknown
  cursor?: unknown
}

interface ApiGroupedResponse {
  query?: unknown
  language?: unknown
  source?: unknown
  groups?: unknown
  hiddenSources?: unknown
}

interface ApiTrackDetail {
  track?: unknown
  artists?: unknown
  albums?: unknown
  playlists?: unknown
  madeForKids?: unknown
}

interface ApiProviderInfo {
  id?: unknown
  name?: unknown
  description?: unknown
  configured?: unknown
  status?: unknown
  message?: unknown
}

type RemoteApiSource = Extract<CatalogSource, 'audius' | 'jamendo' | 'youtube'>

/** One health probe per session; `null` until the first decision is made. */
let probePromise: Promise<boolean> | null = null

/** Literal import.meta.env reads so Vite bakes values at build time. */
export function readApiConfig(rawEnv: {
  VITE_API_BASE?: string
  VITE_API_ENABLED?: string
}): { base: string; enabled: 'unset' | 'on' | 'off' } {
  const base = (rawEnv.VITE_API_BASE ?? '').trim().replace(/\/+$/, '')
  const flag = (rawEnv.VITE_API_ENABLED ?? '').trim().toLowerCase()
  return { base, enabled: flag === '0' || flag === 'off' || flag === 'false' ? 'off' : flag === '1' || flag === 'on' || flag === 'true' ? 'on' : 'unset' }
}

function liveConfig(): { base: string; enabled: 'unset' | 'on' | 'off' } {
  return readApiConfig({
    VITE_API_BASE: import.meta.env.VITE_API_BASE as string | undefined,
    VITE_API_ENABLED: import.meta.env.VITE_API_ENABLED as string | undefined,
  })
}

/** Base URL for API calls (empty string = same origin). */
export function apiBase(): string {
  return liveConfig().base
}

/** Test hook: forget the cached availability decision. */
export function resetApiProbe(): void {
  probePromise = null
}

async function fetchJson(path: string, timeoutMs = 6000): Promise<unknown> {
  const { base } = liveConfig()
  const controller = typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal ? AbortSignal.timeout(timeoutMs) : undefined
  const response = await fetch(`${base}${path}`, {
    headers: { Accept: 'application/json' },
    signal: controller ?? null,
  })
  if (!response.ok) {
    const error = new Error(`API ${response.status}`) as Error & { status: number }
    error.status = response.status
    throw error
  }
  return response.json() as Promise<unknown>
}

/**
 * Is the API reachable for this session? Resolves at most once; failures are
 * sticky so a static host never gets probed on every keystroke.
 */
export function apiAvailable(): Promise<boolean> {
  if (probePromise) return probePromise
  const { enabled } = liveConfig()
  if (enabled === 'off') {
    probePromise = Promise.resolve(false)
    return probePromise
  }
  if (enabled === 'on') {
    probePromise = Promise.resolve(true)
    return probePromise
  }
  probePromise = (async () => {
    try {
      const body = (await fetchJson('/api/health', 2500)) as { status?: unknown }
      return body?.status === 'ok'
    } catch {
      return false
    }
  })()
  return probePromise
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
}

/** Track → Song (identity on the wire; garbage is dropped, never invented). */
export function mapSong(raw: unknown): Song | null {
  if (!isRecord(raw)) return null
  const track = raw as ApiTrack
  const id = asString(track.id)
  const title = asString(track.title)
  const audioUrl = asString(track.audioUrl)
  const albumId = asString(track.albumId)
  if (!id || !title || albumId === undefined) return null
  const song: Song = {
    id,
    title,
    albumId,
    artistIds: asStringArray(track.artistIds),
    durationMs: asNumber(track.durationMs),
    trackNumber: asNumber(track.trackNumber),
    audioUrl: audioUrl ?? '',
  }
  const explicit = asBoolean(track.explicit)
  if (explicit !== undefined) song.explicit = explicit
  const artworkUrl = asString(track.artworkUrl)
  if (artworkUrl) song.artworkUrl = artworkUrl
  const source = asString(track.source)
  if (source === 'demo' || source === 'audius' || source === 'jamendo' || source === 'youtube' || source === 'musickit') {
    song.source = source
  }
  const playbackKind = asString(track.playbackKind)
  if (playbackKind === 'audio' || playbackKind === 'youtube') song.playbackKind = playbackKind
  const externalUrl = asString(track.externalUrl)
  if (externalUrl) song.externalUrl = externalUrl
  const attribution = asString(track.attribution)
  if (attribution) song.attribution = attribution
  const attributionUrl = asString(track.attributionUrl)
  if (attributionUrl) song.attributionUrl = attributionUrl
  const language = asString(track.language)
  if (language) song.language = language
  const languageStatus = asString(track.languageStatus)
  if (languageStatus === 'verified' || languageStatus === 'inferred' || languageStatus === 'unknown') {
    song.languageStatus = languageStatus
  }
  return song
}

export function mapAlbum(raw: unknown): Album | null {
  if (!isRecord(raw)) return null
  const album = raw as ApiAlbum
  const id = asString(album.id)
  const title = asString(album.title)
  const artistId = asString(album.artistId)
  if (!id || !title || !artistId) return null
  const kind = asString(album.kind)
  const result: Album = {
    id,
    title,
    artistId,
    artworkSeed: asString(album.artworkSeed) ?? id,
    releaseDate: asString(album.releaseDate) ?? '',
    genreIds: asStringArray(album.genreIds),
    kind: kind === 'ep' || kind === 'single' ? kind : 'album',
    songIds: asStringArray(album.songIds),
  }
  const copyright = asString(album.copyright)
  if (copyright) result.copyright = copyright
  const label = asString(album.label)
  if (label) result.label = label
  const description = asString(album.description)
  if (description) result.description = description
  return result
}

export function mapArtist(raw: unknown): Artist | null {
  if (!isRecord(raw)) return null
  const artist = raw as ApiArtist
  const id = asString(artist.id)
  const name = asString(artist.name)
  if (!id || !name) return null
  const result: Artist = {
    id,
    name,
    artworkSeed: asString(artist.artworkSeed) ?? id,
    genreIds: asStringArray(artist.genreIds),
  }
  const bio = asString(artist.bio)
  if (bio) result.bio = bio
  return result
}

export function mapPlaylist(raw: unknown): Playlist | null {
  if (!isRecord(raw)) return null
  const playlist = raw as ApiPlaylist
  const id = asString(playlist.id)
  const title = asString(playlist.title)
  if (!id || !title) return null
  const result: Playlist = {
    id,
    title,
    description: asString(playlist.description) ?? '',
    artworkSeed: asString(playlist.artworkSeed) ?? id,
    songIds: asStringArray(playlist.songIds),
    isUserPlaylist: asBoolean(playlist.isUserPlaylist) ?? false,
  }
  const curator = asString(playlist.curator)
  if (curator) result.curator = curator
  const createdAt = asNumber(playlist.createdAt, NaN)
  if (Number.isFinite(createdAt)) result.createdAt = createdAt
  const updatedAt = asNumber(playlist.updatedAt, NaN)
  if (Number.isFinite(updatedAt)) result.updatedAt = updatedAt
  return result
}

function mapResults(raw: unknown, query: string): SearchResults {
  const results = (isRecord(raw) ? raw : {}) as ApiResults
  const songs = Array.isArray(results.songs) ? results.songs.map(mapSong).filter((s): s is Song => s !== null) : []
  const albums = Array.isArray(results.albums) ? results.albums.map(mapAlbum).filter((a): a is Album => a !== null) : []
  const artists = Array.isArray(results.artists) ? results.artists.map(mapArtist).filter((a): a is Artist => a !== null) : []
  const playlists = Array.isArray(results.playlists) ? results.playlists.map(mapPlaylist).filter((p): p is Playlist => p !== null) : []
  registerRemoteEntities({ songs, artists, albums, playlists })
  return { query: asString(results.query) ?? query, songs, albums, artists, playlists }
}

const GROUP_STATUSES = new Set(['ok', 'empty', 'error', 'unconfigured', 'disabled'])

/** One source's slice of the API's grouped response. */
export function mapSearchGroup(raw: unknown, fallbackQuery: string): SearchGroup | null {
  if (!isRecord(raw)) return null
  const group = raw as ApiGroup
  const source = asString(group.source)
  const name = asString(group.name)
  const status = asString(group.status)
  if (!source || !name || !status || !GROUP_STATUSES.has(status)) return null
  const results = mapResults(group.results, fallbackQuery)
  const mapped: SearchGroup = {
    source: source as CatalogSource,
    name,
    status: status as SearchGroup['status'],
    results,
  }
  const message = asString(group.message)
  if (message) mapped.message = message
  const cursor = asString(group.cursor)
  if (cursor) mapped.cursor = cursor
  return mapped
}

/** Full grouped payload (used by tests and any future single-call path). */
export function mapGroupedResponse(raw: unknown, fallbackQuery: string): GroupedSearchResults | null {
  if (!isRecord(raw)) return null
  const payload = raw as ApiGroupedResponse
  const query = asString(payload.query) ?? fallbackQuery
  const language = asString(payload.language) ?? 'all'
  const source = (asString(payload.source) ?? 'all') as SourceFilter
  const groups = Array.isArray(payload.groups)
    ? payload.groups.map((g) => mapSearchGroup(g, query)).filter((g): g is SearchGroup => g !== null)
    : []
  return {
    query,
    language,
    source,
    groups,
    hiddenSources: asStringArray(payload.hiddenSources).filter((s): s is CatalogSource => s === 'audius' || s === 'jamendo' || s === 'youtube'),
  }
}

/**
 * Search one remote source through the API. Throws on transport/HTTP errors —
 * the caller (catalogue facade) falls back to the direct browser provider.
 */
export async function apiSearchGroup(
  source: RemoteApiSource,
  query: string,
  language: string,
): Promise<SearchGroup> {
  const params = new URLSearchParams({ q: query, source, language })
  const body = await fetchJson(`/api/search?${params.toString()}`)
  const grouped = mapGroupedResponse(body, query)
  const group = grouped?.groups.find((g) => g.source === source)
  if (!group) throw new Error('Malformed search response from the API.')
  return group
}

/**
 * Fetch one remote song through the API. `null` = the provider does not know
 * that id (authoritative 404); a thrown error means "try the direct provider".
 */
export async function apiGetSong(source: RemoteApiSource, domainId: string): Promise<Song | null> {
  const body = await fetchJson(`/api/tracks/${source}/${encodeURIComponent(domainId)}`)
  const detail = (isRecord(body) ? body : {}) as ApiTrackDetail
  const song = mapSong(detail.track)
  if (!song) throw new Error('Malformed track response from the API.')
  registerRemoteEntities({
    songs: [song],
    artists: Array.isArray(detail.artists) ? detail.artists.map(mapArtist).filter((a): a is Artist => a !== null) : [],
    albums: Array.isArray(detail.albums) ? detail.albums.map(mapAlbum).filter((a): a is Album => a !== null) : [],
    playlists: Array.isArray(detail.playlists) ? detail.playlists.map(mapPlaylist).filter((p): p is Playlist => p !== null) : [],
  })
  return song
}

/** Lyrics lookup result (LRCLIB via the backend). */
export interface RemoteLyrics {
  found: boolean
  instrumental: boolean
  plainLyrics?: string
  syncedLyrics?: string
  attributionName?: string
  attributionUrl?: string
}

/**
 * Look up lyrics for a track signature. `found: false` is an ordinary miss
 * (the UI shows its empty state and remembers it); transport errors throw so
 * the caller can fall back quietly.
 */
export async function apiGetLyrics(signature: {
  trackName: string
  artistName: string
  albumName?: string
  durationSeconds?: number
}): Promise<RemoteLyrics> {
  const params = new URLSearchParams({
    track_name: signature.trackName,
    artist_name: signature.artistName,
  })
  if (signature.albumName) params.set('album_name', signature.albumName)
  if (signature.durationSeconds) params.set('duration', String(signature.durationSeconds))
  const body = await fetchJson(`/api/lyrics?${params.toString()}`)
  if (!isRecord(body)) throw new Error('Malformed lyrics response from the API.')
  const result: RemoteLyrics = {
    found: asBoolean(body.found) ?? false,
    instrumental: asBoolean(body.instrumental) ?? false,
  }
  const plain = asString(body.plainLyrics)
  if (plain) result.plainLyrics = plain
  const synced = asString(body.syncedLyrics)
  if (synced) result.syncedLyrics = synced
  const name = asString(body.attributionName)
  if (name) result.attributionName = name
  const url = asString(body.attributionUrl)
  if (url) result.attributionUrl = url
  return result
}

/** Server-side provider status for the Settings dialog. `null` = API down. */
export async function fetchServerProviderInfos(): Promise<CatalogProviderInfo[] | null> {
  try {
    const body = (await fetchJson('/api/providers', 4000)) as { providers?: unknown }
    if (!Array.isArray(body?.providers)) return null
    return body.providers
      .filter((p): p is ApiProviderInfo & Record<string, unknown> => isRecord(p))
      .map((p) => {
        const id = asString(p.id)
        const name = asString(p.name)
        if (!id || !name) return null
        const info: CatalogProviderInfo = {
          id: id as CatalogProviderInfo['id'],
          name,
          description: asString(p.description) ?? '',
          configured: asBoolean(p.configured) ?? false,
        }
        return info
      })
      .filter((info): info is CatalogProviderInfo => info !== null)
  } catch {
    return null
  }
}
