/**
 * Optional Apple MusicKit on the Web provider.
 *
 * Verified requirements (https://developer.apple.com/musickit/):
 * - A developer token signed with a .p8 private key from the Apple Developer
 *   Program (Certificates, Identifiers & Profiles). Signing MUST happen on a
 *   server; only the resulting token reaches the browser. Set it via the
 *   VITE_MUSICKIT_DEVELOPER_TOKEN build-time variable.
 * - User authorization (Apple ID) for personal library / recommendations.
 * - An active Apple Music subscription is required to stream catalogue audio.
 *
 * Status: catalog search + entity mapping are implemented defensively and
 * activate only when a developer token is present. Streaming playback through
 * MusicKit's own engine is intentionally not claimed: it has not been tested
 * without credentials. Demo mode remains fully functional without any of this.
 */

import type {
  Album,
  Artist,
  CatalogProvider,
  CatalogProviderInfo,
  SearchResults,
  Song,
} from '@/domain/types'

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

function envToken(): string {
  const token = import.meta.env.VITE_MUSICKIT_DEVELOPER_TOKEN as string | undefined
  return (token ?? '').trim()
}

export function isMusicKitConfigured(): boolean {
  return envToken().length > 0
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
  readonly info: CatalogProviderInfo = {
    id: 'musickit',
    name: 'Apple Music (MusicKit)',
    description: isMusicKitConfigured()
      ? 'Developer token detected. Catalog discovery is enabled; streaming requires user authorization and a subscription.'
      : 'Not configured. Set VITE_MUSICKIT_DEVELOPER_TOKEN (signed server-side with your .p8 key) to enable.',
    configured: isMusicKitConfigured(),
  }

  private music: AnyRecord | null = null

  async init(): Promise<AnyRecord | null> {
    if (this.music) return this.music
    const token = envToken()
    if (!token) return null
    try {
      if (!document.querySelector(`script[src="${MUSICKIT_SRC}"]`)) {
        await new Promise<void>((resolve, reject) => {
          const el = document.createElement('script')
          el.src = MUSICKIT_SRC
          el.async = true
          el.onload = () => resolve()
          el.onerror = () => reject(new Error('Failed to load MusicKit JS'))
          document.head.appendChild(el)
        })
      }
      const MK = (window as unknown as { MusicKit?: AnyRecord }).MusicKit
      if (!MK) return null
      const configure = MK['configure'] as ((opts: unknown) => Promise<unknown>) | undefined
      const instance = configure ? await configure({
        developerToken: token,
        app: { name: 'Sonora', build: '0.1.0' },
      }) : undefined
      const getInstance = MK['getInstance'] as (() => unknown) | undefined
      this.music = (instance as AnyRecord | null | undefined) ?? ((getInstance?.() as AnyRecord | null) ?? null)
      return this.music
    } catch {
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
