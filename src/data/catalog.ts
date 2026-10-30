/**
 * Catalogue facade. UI always talks to this module, never to a concrete
 * provider — so providers can be swapped or layered without touching views.
 *
 * Provider priority:
 * 1. Audius (free public API) — ON by default (VITE_AUDIUS_ENABLED=0 to
 *    disable). Primary external catalogue: search, charts, artists,
 *    playlists, artist albums, real streaming URLs. Entity ids are prefix-
 *    routed: `au-*` → Audius, everything else → demo.
 * 2. Jamendo (free Creative Commons catalogue) — offered once a public
 *    client id is set (VITE_JAMENDO_CLIENT_ID from devportal.jamendo.com).
 *    Search + track/album/artist pages + direct mp3 streaming + CC licence
 *    attribution; ids are prefix-routed `jm-*`. Without a client id the
 *    source is never offered and no request is made.
 * 3. MusicKit (optional, two-key gate) — search only when configured.
 * 4. Demo catalogue — always present; the fallback whenever a remote
 *    provider fails (an Audius outage can never break the app).
 *
 * Home/browse: the demo feed is the base; Audius songs/playlists overlay
 * its song sections when available. Stations, genres and editorial feature
 * cards stay demo-only (Audius has no equivalents — documented in
 * data/audius-normalize.ts).
 *
 * Search comes in two shapes: `searchGrouped()` keeps every source's slice
 * separate (language + source selectors, per-source failure isolation) and
 * `search()` / `catalog.search()` flatten it for the tabbed results UI.
 */

import type {
  Album,
  Artist,
  BrowseData,
  CatalogProvider,
  CatalogProviderInfo,
  CatalogSource,
  Genre,
  GroupedSearchResults,
  HomeFeed,
  Playlist,
  SearchGroup,
  SearchQueryOptions,
  SearchResults,
  Song,
  Station,
} from '@/domain/types'
import { DemoCatalogProvider } from '@/data/demo-provider'
import { MusicKitProvider, isMusicKitConfigured } from '@/data/musickit-provider'
import { AudiusProvider, isAudiusConfigured } from '@/data/audius-provider'
import { JamendoProvider, isJamendoConfigured } from '@/data/jamendo-provider'
import { YoutubeProvider, isYoutubeConfigured } from '@/data/youtube-provider'
import {
  apiAvailable,
  apiGetSong,
  apiSearchGroup,
  fetchServerProviderInfos,
  isAbortError,
} from '@/data/api-client'
import { describeAudiusConfig } from '@/data/audius-config'
import { describeJamendoConfig, readJamendoConfig } from '@/data/jamendo-config'
import { describeMusicKitConfig, readMusicKitConfig } from '@/data/musickit-token'
import { describeYoutubeConfig, readYoutubeConfig } from '@/data/youtube-config'
import { youtubeChannelId, youtubeAlbumVideoId, youtubeVideoId } from '@/data/youtube-normalize'
import { ALL_LANGUAGES, normalizeLanguage, songMatchesLanguage } from '@/data/languages'
import { SOURCE_ORDER, normalizeSourceFilter, sourceName, sourceSupportsLanguage } from '@/data/sources'

const demo = new DemoCatalogProvider()
const audius = new AudiusProvider()
const jamendo = new JamendoProvider()
const youtube = new YoutubeProvider()
const musickit = new MusicKitProvider()

const isAu = (id: string): boolean => id.startsWith('au-')
const isJm = (id: string): boolean => id.startsWith('jm-')
const isYt = (id: string): boolean => id.startsWith('yt-')

/** Server-side source that owns this domain id, or null for local ids. */
function remoteSourceFor(id: string): 'audius' | 'jamendo' | 'youtube' | null {
  if (isAu(id)) return 'audius'
  if (isJm(id)) return 'jamendo'
  if (youtubeVideoId(id)) return 'youtube'
  return null
}

export const catalog: CatalogProvider = {
  info: demo.info,

  async getHome(): Promise<HomeFeed> {
    const base = await demo.getHome()
    if (!isAudiusConfigured()) return base
    try {
      const feed = await audius.getHome()
      return {
        ...base,
        bestNewSongs: feed.bestNewSongs.length ? feed.bestNewSongs : base.bestNewSongs,
        topCharts: feed.topCharts.length ? feed.topCharts : base.topCharts,
        madeForYou: feed.madeForYou.length ? feed.madeForYou : base.madeForYou,
      }
    } catch {
      return base
    }
  },

  async getBrowse(): Promise<BrowseData> {
    const base = await demo.getBrowse()
    if (!isAudiusConfigured()) return base
    try {
      const data = await audius.getBrowse()
      return {
        ...base,
        topCharts: data.topCharts.length ? data.topCharts : base.topCharts,
        playlists: data.playlists.length ? data.playlists : base.playlists,
      }
    } catch {
      return base
    }
  },

  getStations(): Promise<Station[]> {
    return demo.getStations()
  },

  getStation(id: string): Promise<Station | null> {
    return demo.getStation(id)
  },

  async search(query: string, options?: SearchQueryOptions): Promise<SearchResults> {
    return flattenGrouped(await searchGrouped(query, options))
  },

  async getSong(id: string): Promise<Song | null> {
    // Remote ids: prefer the API (server holds the provider credentials), but
    // never require it — a 404 is authoritative, anything else falls back to
    // the direct browser provider.
    const remote = remoteSourceFor(id)
    if (remote && (await apiAvailable())) {
      try {
        return await apiGetSong(remote, id)
      } catch (err) {
        const status = (err as { status?: number }).status
        if (status === 404) return null
      }
    }
    if (isAu(id)) {
      try {
        return await audius.getSong(id)
      } catch {
        return null
      }
    }
    if (isJm(id)) {
      try {
        return await jamendo.getSong(id)
      } catch {
        return null
      }
    }
    if (youtubeVideoId(id)) {
      try {
        return await youtube.getSong(id)
      } catch {
        return null
      }
    }
    return demo.getSong(id)
  },

  async getAlbum(id: string): Promise<Album | null> {
    if (isAu(id)) {
      try {
        return await audius.getAlbum(id)
      } catch {
        return null
      }
    }
    if (isJm(id)) {
      try {
        return await jamendo.getAlbum(id)
      } catch {
        return null
      }
    }
    if (youtubeAlbumVideoId(id)) {
      try {
        return await youtube.getAlbum(id)
      } catch {
        return null
      }
    }
    return demo.getAlbum(id)
  },

  async getArtist(id: string): Promise<Artist | null> {
    if (isAu(id)) {
      try {
        return await audius.getArtist(id)
      } catch {
        return null
      }
    }
    if (isJm(id)) {
      try {
        return await jamendo.getArtist(id)
      } catch {
        return null
      }
    }
    if (youtubeChannelId(id)) {
      try {
        return await youtube.getArtist(id)
      } catch {
        return null
      }
    }
    return demo.getArtist(id)
  },

  async getPlaylist(id: string): Promise<Playlist | null> {
    if (isAu(id)) {
      try {
        return await audius.getPlaylist(id)
      } catch {
        return null
      }
    }
    // Jamendo read surface has no playlists — never invent one for jm-* ids.
    if (isJm(id)) return null
    // YouTube exposes no playlists through this integration — never invent one.
    if (isYt(id)) return null
    return demo.getPlaylist(id)
  },

  getGenre(id: string): Promise<Genre | null> {
    // Jamendo exposes no genre pages (documented) — jm-* ids are not genres.
    if (isJm(id)) return Promise.resolve(null)
    // YouTube exposes no genre pages — yt-* ids are not genres.
    if (isYt(id)) return Promise.resolve(null)
    return demo.getGenre(id)
  },

  async getSongsByAlbum(albumId: string): Promise<Song[]> {
    if (isAu(albumId)) {
      try {
        return await audius.getSongsByAlbum(albumId)
      } catch {
        return []
      }
    }
    if (isJm(albumId)) {
      try {
        return await jamendo.getSongsByAlbum(albumId)
      } catch {
        return []
      }
    }
    if (youtubeAlbumVideoId(albumId)) {
      try {
        return await youtube.getSongsByAlbum(albumId)
      } catch {
        return []
      }
    }
    return demo.getSongsByAlbum(albumId)
  },

  async getAlbumsByArtist(artistId: string): Promise<Album[]> {
    if (isAu(artistId)) {
      try {
        return await audius.getAlbumsByArtist(artistId)
      } catch {
        return []
      }
    }
    if (isJm(artistId)) {
      try {
        return await jamendo.getAlbumsByArtist(artistId)
      } catch {
        return []
      }
    }
    if (youtubeChannelId(artistId)) {
      try {
        return await youtube.getAlbumsByArtist()
      } catch {
        return []
      }
    }
    return demo.getAlbumsByArtist(artistId)
  },

  async getTopSongsByArtist(artistId: string): Promise<Song[]> {
    if (isAu(artistId)) {
      try {
        return await audius.getTopSongsByArtist(artistId)
      } catch {
        return []
      }
    }
    if (isJm(artistId)) {
      try {
        return await jamendo.getTopSongsByArtist(artistId)
      } catch {
        return []
      }
    }
    if (youtubeChannelId(artistId)) {
      try {
        return await youtube.getTopSongsByArtist(artistId)
      } catch {
        return []
      }
    }
    return demo.getTopSongsByArtist(artistId)
  },
}

export function providerInfos(): CatalogProviderInfo[] {
  return [demo.info, audius.info, jamendo.info, youtube.info, musickit.info]
}

/**
 * Provider status merged with the server's view (Settings dialog). The API is
 * the source of truth for remote sources when it is reachable; browser-side
 * config stays authoritative for demo/MusicKit and as the offline fallback.
 */
export async function resolveProviderInfos(): Promise<CatalogProviderInfo[]> {
  const local = providerInfos()
  if (!(await apiAvailable())) return local
  const server = await fetchServerProviderInfos()
  if (!server) return local
  const byId = new Map(local.map((info) => [info.id, info]))
  for (const info of server) {
    const existing = byId.get(info.id)
    if (existing) {
      byId.set(info.id, {
        ...existing,
        // Either side being configured means the source can be searched.
        configured: existing.configured || info.configured,
        description: info.description || existing.description,
      })
    } else {
      byId.set(info.id, info)
    }
  }
  return Array.from(byId.values())
}

/**
 * videos.list `status.madeForKids` for a `yt-…` song id, from this session's
 * detail lookups (never persisted; Developer Policies III.E.4.j requires the
 * lookup). `undefined` = unknown → callers must embed conservatively
 * (privacy-enhanced / nocookie).
 */
export function youtubeMadeForKids(domainId: string): boolean | undefined {
  const videoId = youtubeVideoId(domainId)
  return videoId ? youtube.madeForKids(videoId) : undefined
}

/** Empty slice for a source that produced nothing (or never ran). */
function emptyResults(query: string): SearchResults {
  return { query, songs: [], albums: [], artists: [], playlists: [] }
}

/**
 * Sources this build can actually search right now, in canonical order.
 * Jamendo and YouTube are offered only when configured (public client id /
 * public API key); without them the source never appears and never fetches.
 */
export function availableSources(): CatalogSource[] {
  const live = new Set<CatalogSource>(['demo'])
  if (isAudiusConfigured()) live.add('audius')
  if (isJamendoConfigured()) live.add('jamendo')
  if (isYoutubeConfigured()) live.add('youtube')
  if (isMusicKitConfigured()) live.add('musickit')
  return SOURCE_ORDER.filter((s) => live.has(s))
}

/**
 * Sources this deployment can search, including those configured only on the
 * server (the normal case: API keys live in the backend's env, not the
 * bundle). Falls back to the browser-side view whenever the API is absent.
 */
export async function resolveAvailableSources(): Promise<CatalogSource[]> {
  const local = availableSources()
  if (!(await apiAvailable())) return local
  const server = await fetchServerProviderInfos()
  if (!server) return local
  const live = new Set<CatalogSource>(local)
  for (const info of server) {
    if (info.configured && (info.id === 'audius' || info.id === 'jamendo' || info.id === 'youtube')) {
      live.add(info.id)
    }
  }
  return SOURCE_ORDER.filter((s) => live.has(s))
}

/**
 * Sources merged into the “All sources” aggregation. YouTube is deliberately
 * excluded: current YouTube API policy guidance is ambiguous about combining
 * API data with other sources (Developer Policies III.E.2 / III.C.5 vs. the
 * compliance guide's side-by-side example), so YouTube results only ever
 * appear in their own dedicated source view (`?src=youtube`) and /watch —
 * see README “YouTube integration”. All-languages/All-sources behaviour for
 * every other provider is unchanged.
 */
function aggregatedInAll(source: CatalogSource): boolean {
  return source !== 'youtube'
}

/** Per-track language safety net (inert today: no provider reports a language). */
function filterByLanguage(results: SearchResults, language: string): SearchResults {
  if (language === ALL_LANGUAGES) return results
  return { ...results, songs: results.songs.filter((s) => songMatchesLanguage(s, language)) }
}

async function runSource(
  source: CatalogSource,
  query: string,
  language: string,
  signal?: AbortSignal,
): Promise<SearchGroup> {
  const name = sourceName(source)
  // Remote sources prefer the API (it holds the provider credentials and
  // applies the language truth table server-side). An unconfigured/disabled
  // server answer falls through to the browser-side provider, which may still
  // have its own VITE_* config — best available truth, not exclusive modes.
  if (source !== 'demo' && source !== 'musickit' && (await apiAvailable())) {
    try {
      const group = await apiSearchGroup(source, query, language, signal)
      if (group.status !== 'unconfigured' && group.status !== 'disabled') return group
    } catch (err) {
      // A superseded search stops here: no fallback request for a query the
      // user has already replaced (the view drops cancelled rejections).
      if (isAbortError(err) || signal?.aborted) throw err
      // API down mid-session or malformed — fall back to the direct provider.
    }
  }
  // Cancellation check for the fallback path (API off/unavailable, or the
  // abort landed while the availability probe was still running).
  if (signal?.aborted) {
    const cancelled = new Error('Search cancelled')
    cancelled.name = 'AbortError'
    throw cancelled
  }
  try {
    let raw: SearchResults
    let cursor: string | undefined
    if (source === 'demo') {
      raw = await demo.search(query)
    } else if (source === 'audius') {
      raw = await audius.search(query)
    } else if (source === 'jamendo') {
      // Jamendo filters by the documented `lang` parameter server-side; its
      // musicinfo language is ISO-only, so re-checking it client-side would
      // false-exclude under zh-Hans/zh-Hant — the safety net is skipped here.
      const page = await jamendo.searchPage(query, { language })
      raw = page.results
      cursor = page.cursor
    } else if (source === 'youtube') {
      // YouTube applies `relevanceLanguage` server-side (a relevance *hint*,
      // not a language verification — documented in README/plan). The client-
      // side safety net cannot exclude yt songs (they carry no verified
      // language), so results are shown as YouTube's, never re-labelled.
      const page = await youtube.searchPage(query, { language })
      raw = page.results
      cursor = page.cursor
    } else {
      raw = await musickit.search(query)
    }
    const results =
      source === 'jamendo' || source === 'youtube' ? raw : filterByLanguage(raw, language)
    const total = results.songs.length + results.albums.length + results.artists.length + results.playlists.length
    return { source, name, status: total > 0 ? 'ok' : 'empty', results, cursor }
  } catch (err) {
    const detail = err instanceof Error && err.message ? `: ${err.message}` : ''
    return { source, name, status: 'error', message: `Search failed${detail}`, results: emptyResults(query) }
  }
}

/** Honest status for a source the user picked that this build cannot search. */
function unavailableGroup(source: CatalogSource, query: string): SearchGroup {
  const name = sourceName(source)
  if (source === 'audius') {
    return { source, name, status: 'disabled', message: describeAudiusConfig(), results: emptyResults(query) }
  }
  if (source === 'jamendo') {
    const config = readJamendoConfig()
    return {
      source,
      name,
      status: config.enabled ? 'unconfigured' : 'disabled',
      message: describeJamendoConfig(config),
      results: emptyResults(query),
    }
  }
  if (source === 'musickit') {
    return {
      source,
      name,
      status: 'unconfigured',
      message: describeMusicKitConfig(readMusicKitConfig()),
      results: emptyResults(query),
    }
  }
  if (source === 'youtube') {
    const config = readYoutubeConfig()
    return {
      source,
      name,
      status: config.enabled ? 'unconfigured' : 'disabled',
      message: describeYoutubeConfig(config),
      results: emptyResults(query),
    }
  }
  return {
    source,
    name,
    status: 'unconfigured',
    message: `${name} is not connected to this build's catalogue.`,
    results: emptyResults(query),
  }
}

/**
 * Search grouped by source. Every eligible source is queried independently
 * (one failure never breaks the rest); sources that cannot apply the selected
 * language are listed in `hiddenSources` instead of being searched, so no
 * result is ever presented as language-matched when it is not.
 *
 * Defaults: language `all`, source `all` — every configured source searched.
 */
export async function searchGrouped(
  query: string,
  options: SearchQueryOptions = {},
): Promise<GroupedSearchResults> {
  const language = normalizeLanguage(options.language)
  const source = normalizeSourceFilter(options.source)
  const available = await resolveAvailableSources()
  // `all` aggregates every configured source EXCEPT YouTube (dedicated-view
  // policy decision — see aggregatedInAll). An explicit `src=youtube` still
  // gets the full dedicated YouTube view, configured or not.
  const requested: CatalogSource[] =
    source === 'all' ? available.filter(aggregatedInAll) : [source]

  if (source !== 'all' && !available.includes(source)) {
    return { query, language, source, hiddenSources: [], groups: [unavailableGroup(source, query)] }
  }

  const eligible = requested.filter((s) => sourceSupportsLanguage(s, language))
  const hiddenSources = requested.filter((s) => !sourceSupportsLanguage(s, language))
  const groups = await Promise.all(eligible.map((s) => runSource(s, query, language, options.signal)))
  return { query, language, source, hiddenSources, groups }
}

/**
 * Merge grouped results into the flat shape the tabbed results UI renders —
 * canonical source order, legacy slice limits, demo standing alone (unsliced)
 * whenever no remote group is usable.
 */
export function flattenGrouped(grouped: GroupedSearchResults): SearchResults {
  const group = (source: CatalogSource): SearchResults | undefined => {
    const g = grouped.groups.find((x) => x.source === source)
    return g && (g.status === 'ok' || g.status === 'empty') ? g.results : undefined
  }
  const remote = group('audius')
  const jamendoGroup = group('jamendo')
  const youtubeGroup = group('youtube')
  const musicKit = group('musickit')
  const local = group('demo') ?? emptyResults(grouped.query)

  // A remote group that merely produced zero hits still counts: demo only
  // stands alone when no remote source answered at all (or was even asked).
  if (!remote && !jamendoGroup && !youtubeGroup && !musicKit) return local
  // Remote hits come ahead of local matches (SOURCE_ORDER: audius, jamendo,
  // youtube, musickit, demo). YouTube only ever appears as its own dedicated
  // slice (excluded from `all`), so its position here never blends rows into
  // another provider's results.
  return {
    query: grouped.query,
    songs: [
      ...(remote?.songs ?? []),
      ...(jamendoGroup?.songs ?? []),
      ...(youtubeGroup?.songs ?? []),
      ...(musicKit?.songs ?? []),
      ...local.songs,
    ].slice(0, 30),
    albums: [
      ...(jamendoGroup?.albums ?? []),
      ...(youtubeGroup?.albums ?? []),
      ...(musicKit?.albums ?? []),
      ...local.albums,
    ].slice(0, 20),
    artists: [
      ...(remote?.artists ?? []),
      ...(jamendoGroup?.artists ?? []),
      ...(youtubeGroup?.artists ?? []),
      ...(musicKit?.artists ?? []),
      ...local.artists,
    ].slice(0, 12),
    playlists: [...(remote?.playlists ?? []), ...local.playlists].slice(0, 12),
  }
}

export async function search(query: string, options?: SearchQueryOptions): Promise<SearchResults> {
  return flattenGrouped(await searchGrouped(query, options))
}

export async function authorizeAppleMusic(): Promise<{ ok: boolean; message: string }> {
  return musickit.authorize()
}
