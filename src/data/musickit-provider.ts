/**
 * Optional Apple MusicKit on the Web provider.
 *
 * Verified requirements (https://developer.apple.com/musickit/):
 * - A developer token signed with a .p8 private key from the Apple Developer
 *   Program (Certificates, Identifiers & Profiles). Signing MUST happen on a
 *   server; only the resulting token reaches the browser. M1 plumbing:
 *   fetch it at runtime from VITE_MUSICKIT_TOKEN_URL, or use a pre-signed
 *   VITE_MUSICKIT_DEVELOPER_TOKEN for local development only.
 * - Activation is a two-key gate (VITE_MUSICKIT_ENABLED + a token source);
 *   without both, init() returns before any network request, so no MusicKit
 *   CDN script and no token fetch happen in credential-less builds.
 * - User authorization (Apple ID) for personal library / recommendations.
 * - An active Apple Music subscription is required to stream catalogue audio.
 *
 * Status: catalog search + entity mapping are implemented defensively and
 * activate only when the gate passes. Streaming playback through MusicKit's
 * own engine is intentionally not claimed: it has not been tested with real
 * credentials. Demo mode remains fully functional without any of this.
 * init() failure can never throw into callers — it resolves to null and the
 * catalogue facade falls back to the demo provider.
 */

import type {
  Album,
  Artist,
  CatalogProvider,
  CatalogProviderInfo,
  SearchResults,
  Song,
} from '@/domain/types'
import {
  createTokenSource,
  describeMusicKitConfig,
  isMusicKitConfigured,
  readMusicKitConfig,
  type MusicKitConfig,
  type TokenSource,
} from '@/data/musickit-token'

export { isMusicKitConfigured }

const MUSICKIT_SRC = 'https://js-cdn.music.apple.com/musickit/v3/musickit.js'

interface MusicKitArtistAttr {
  name: string
}
interface MusicKitArtwork {
  url: string
}
interface MusicKitSongAttr {
  name: string
  artistName: string
  artistId?: number
  albumName: string
  albumId?: number
  durationInMillis?: number
  artwork?: MusicKitArtwork
  previews?: Array<{ url?: string }>
  contentRating?: string
}
interface MusicKitCatalogItem {
  id: string
  type: string
  attributes?: Record<string, unknown>
}

type AnyRecord = Record<string, unknown>

/** Single-flight CDN loader: no script tag until a token is in hand. */
let scriptPromise: Promise<void> | null = null

function ensureMusicKitScript(): Promise<void> {
  const win = window as unknown as { MusicKit?: unknown }
  if (win.MusicKit) return Promise.resolve()
  if (scriptPromise) return scriptPromise
  scriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector(`script[src="${MUSICKIT_SRC}"]`) as HTMLScriptElement | null
    const el = existing ?? document.createElement('script')
    el.src = MUSICKIT_SRC
    el.async = true
    el.onload = () => resolve()
    el.onerror = () => {
      scriptPromise = null
      reject(new Error('Failed to load MusicKit JS'))
    }
    if (!existing) document.head.appendChild(el)
  })
  return scriptPromise
}

function artworkUrl(artwork?: MusicKitArtwork, size = 400): string | undefined {
  if (!artwork?.url) return undefined
  return artwork.url.replace('{w}', String(size)).replace('{h}', String(size))
}

function toSong(item: MusicKitCatalogItem): Song | null {
  if (item.type !== 'songs') return null
  const a = item.attributes as unknown as MusicKitSongAttr | undefined
  if (!a) return null
  return {
    id: `mk-song-${item.id}`,
    title: a.name,
    albumId: `mk-album-${a.albumId ?? 'unknown'}`,
    artistIds: a.artistId ? [`mk-artist-${a.artistId}`] : [],
    durationMs: a.durationInMillis ?? 0,
    trackNumber: 0,
    // MusicKit catalogue audio is not a plain URL; playback requires the
    // MusicKit engine + subscription. Left empty on purpose.
    audioUrl: a.previews?.[0]?.url ?? '',
    explicit: a.contentRating === 'explicit',
  }
}

function toAlbum(item: MusicKitCatalogItem): Album | null {
  if (item.type !== 'albums') return null
  const a = item.attributes as AnyRecord | undefined
  if (!a) return null
  const name = String(a['artistName'] ?? '')
  return {
    id: `mk-album-${item.id}`,
    title: String(a['name'] ?? ''),
    artistId: a['artistId'] ? `mk-artist-${a['artistId']}` : 'mk-artist-unknown',
    artworkSeed: artworkUrl(a['artwork'] as MusicKitArtwork) ?? `mk-album-${item.id}`,
    releaseDate: String(a['releaseDate'] ?? ''),
    genreIds: [],
    kind: 'album',
    songIds: [],
    description: name,
  }
}

function toArtist(item: MusicKitCatalogItem): Artist | null {
  if (item.type !== 'artists') return null
  const a = item.attributes as MusicKitArtistAttr | undefined
  if (!a?.name) return null
  return {
    id: `mk-artist-${item.id}`,
    name: a.name,
    artworkSeed: `mk-artist-${item.id}`,
    genreIds: [],
  }
}

export class MusicKitProvider implements CatalogProvider {
  readonly info: CatalogProviderInfo
  private readonly tokens: TokenSource
  private readonly config: MusicKitConfig

  constructor(
    tokens?: TokenSource,
    config: MusicKitConfig = readMusicKitConfig(),
  ) {
    this.config = config
    this.tokens = tokens ?? createTokenSource({ config })
    this.info = {
      id: 'musickit',
      name: 'Apple Music (MusicKit)',
      description: describeMusicKitConfig(config),
      configured: isMusicKitConfigured(config),
    }
  }

  private music: AnyRecord | null = null

  private async configureSdk(developerToken: string): Promise<AnyRecord | null> {
    await ensureMusicKitScript()
    const MK = (window as unknown as { MusicKit?: AnyRecord }).MusicKit
    if (!MK) return null
    const configure = MK['configure'] as ((opts: unknown) => Promise<unknown>) | undefined
    if (!configure) return null
    let instance: unknown
    try {
      instance = await configure({
        developerToken,
        app: { name: 'Sonora', build: '0.1.0' },
      })
    } catch (err) {
      // A cached token may have been rejected/expired server-side: force one
      // refresh from the token service and retry. Static tokens cannot refresh.
      if (!this.tokens.isDynamic) throw err
      this.tokens.invalidate()
      instance = await configure({
        developerToken: await this.tokens.getToken(),
        app: { name: 'Sonora', build: '0.1.0' },
      })
    }
    const getInstance = MK['getInstance'] as (() => unknown) | undefined
    return ((instance as AnyRecord | null | undefined) ?? (getInstance?.() as AnyRecord | null)) ?? null
  }

  async init(): Promise<AnyRecord | null> {
    if (this.music) return this.music
    // Two-key gate first: credential-less builds must not fetch a token or
    // load the MusicKit CDN script at all.
    if (!isMusicKitConfigured(this.config)) return null
    try {
      // Token BEFORE script load: a failing token service never triggers a
      // CDN request, keeping the demo path network-identical to today.
      const token = await this.tokens.getToken()
      this.music = await this.configureSdk(token)
      return this.music
    } catch {
      // Never throw into the catalogue facade / UI — fall back to demo.
      this.music = null
      return null
    }
  }

  async authorize(): Promise<{ ok: boolean; message: string }> {
    const music = await this.init()
    if (!music) return { ok: false, message: 'MusicKit is not configured.' }
    try {
      const authorize = (music as AnyRecord)['authorize'] as (() => Promise<unknown>) | undefined
      const userToken = authorize ? await authorize() : undefined
      return { ok: Boolean(userToken), message: userToken ? 'Authorized with Apple Music.' : 'Authorization was not completed.' }
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : 'Authorization failed.' }
    }
  }

  private async api(): Promise<AnyRecord | null> {
    const music = await this.init()
    const api = (music as AnyRecord | null)?.['api'] as AnyRecord | undefined
    return api ?? null
  }

  private async searchRaw(term: string): Promise<MusicKitCatalogItem[]> {
    const api = await this.api()
    if (!api) return []
    const searchFn = api['search'] as ((t: string) => Promise<unknown>) | undefined
    if (!searchFn) return []
    const res = (await searchFn(term)) as AnyRecord | undefined
    const songsGroup = res?.['songs'] as { data?: MusicKitCatalogItem[] } | undefined
    return songsGroup?.data ?? []
  }

  async search(query: string): Promise<SearchResults> {
    const empty: SearchResults = { query, songs: [], albums: [], artists: [], playlists: [] }
    if (!query.trim()) return empty
    try {
      const items = await this.searchRaw(query)
      const songs = items.map(toSong).filter((s): s is Song => Boolean(s))
      return {
        query,
        songs,
        albums: items.map(toAlbum).filter((a): a is Album => Boolean(a)),
        artists: items.map(toArtist).filter((a): a is Artist => Boolean(a)),
        playlists: [],
      }
    } catch {
      return empty
    }
  }

  async getHome(): Promise<never> {
    throw new Error('MusicKit home feed is not implemented; use the demo provider.')
  }
  async getBrowse(): Promise<never> {
    throw new Error('MusicKit browse is not implemented; use the demo provider.')
  }
  async getStations() {
    return []
  }
  async getStation() {
    return null
  }
  async getSong(): Promise<Song | null> {
    return null
  }
  async getAlbum(): Promise<Album | null> {
    return null
  }
  async getArtist(): Promise<Artist | null> {
    return null
  }
  async getPlaylist() {
    return null
  }
  async getGenre() {
    return null
  }
  async getSongsByAlbum() {
    return []
  }
  async getAlbumsByArtist() {
    return []
  }
  async getTopSongsByArtist() {
    return []
  }
}
