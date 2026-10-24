/**
 * Catalogue facade. UI always talks to this module, never to a concrete
 * provider — so providers can be swapped or layered without touching views.
 *
 * Provider priority:
 * 1. Audius (free public API) — ON by default (VITE_AUDIUS_ENABLED=0 to
 *    disable). Primary external catalogue: search, charts, artists,
 *    playlists, artist albums, real streaming URLs. Entity ids are prefix-
 *    routed: `au-*` → Audius, everything else → demo.
 * 2. MusicKit (optional, two-key gate) — search only when configured.
 * 3. Demo catalogue — always present; the fallback whenever a remote
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
import { describeAudiusConfig } from '@/data/audius-config'
import { describeMusicKitConfig, readMusicKitConfig } from '@/data/musickit-token'
import { ALL_LANGUAGES, normalizeLanguage, songMatchesLanguage } from '@/data/languages'
import { SOURCE_ORDER, normalizeSourceFilter, sourceName, sourceSupportsLanguage } from '@/data/sources'

const demo = new DemoCatalogProvider()
const audius = new AudiusProvider()
const musickit = new MusicKitProvider()

const isAu = (id: string): boolean => id.startsWith('au-')

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
    if (isAu(id)) {
      try {
        return await audius.getSong(id)
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
    return demo.getPlaylist(id)
  },

  getGenre(id: string): Promise<Genre | null> {
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
    return demo.getTopSongsByArtist(artistId)
  },
}

export function providerInfos(): CatalogProviderInfo[] {
  return [demo.info, audius.info, musickit.info]
}

/** Empty slice for a source that produced nothing (or never ran). */
function emptyResults(query: string): SearchResults {
  return { query, songs: [], albums: [], artists: [], playlists: [] }
}

/**
 * Sources this build can actually search right now, in canonical order.
 * Jamendo/YouTube providers exist in the tree but are not wired into this
 * facade, so they are never offered as working sources.
 */
export function availableSources(): CatalogSource[] {
  const live = new Set<CatalogSource>(['demo'])
  if (isAudiusConfigured()) live.add('audius')
  if (isMusicKitConfigured()) live.add('musickit')
  return SOURCE_ORDER.filter((s) => live.has(s))
}

/** Per-track language safety net (inert today: no provider reports a language). */
function filterByLanguage(results: SearchResults, language: string): SearchResults {
  if (language === ALL_LANGUAGES) return results
  return { ...results, songs: results.songs.filter((s) => songMatchesLanguage(s, language)) }
}

async function runSource(source: CatalogSource, query: string, language: string): Promise<SearchGroup> {
  const name = sourceName(source)
  try {
    const raw =
      source === 'demo'
        ? await demo.search(query)
        : source === 'audius'
          ? await audius.search(query)
          : await musickit.search(query)
    const results = filterByLanguage(raw, language)
    const total = results.songs.length + results.albums.length + results.artists.length + results.playlists.length
    return { source, name, status: total > 0 ? 'ok' : 'empty', results }
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
  if (source === 'musickit') {
    return {
      source,
      name,
      status: 'unconfigured',
      message: describeMusicKitConfig(readMusicKitConfig()),
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
  const available = availableSources()
  const requested: CatalogSource[] = source === 'all' ? available : [source]

  if (source !== 'all' && !available.includes(source)) {
    return { query, language, source, hiddenSources: [], groups: [unavailableGroup(source, query)] }
  }

  const eligible = requested.filter((s) => sourceSupportsLanguage(s, language))
  const hiddenSources = requested.filter((s) => !sourceSupportsLanguage(s, language))
  const groups = await Promise.all(eligible.map((s) => runSource(s, query, language)))
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
  const musicKit = group('musickit')
  const local = group('demo') ?? emptyResults(grouped.query)

  if (!remote && !musicKit) return local
  // Remote hits come ahead of local matches (MusicKit ordering preserved).
  return {
    query: grouped.query,
    songs: [...(remote?.songs ?? []), ...(musicKit?.songs ?? []), ...local.songs].slice(0, 30),
    albums: [...(musicKit?.albums ?? []), ...local.albums].slice(0, 20),
    artists: [...(remote?.artists ?? []), ...(musicKit?.artists ?? []), ...local.artists].slice(0, 12),
    playlists: [...(remote?.playlists ?? []), ...local.playlists].slice(0, 12),
  }
}

export async function search(query: string, options?: SearchQueryOptions): Promise<SearchResults> {
  return flattenGrouped(await searchGrouped(query, options))
}

export async function authorizeAppleMusic(): Promise<{ ok: boolean; message: string }> {
  return musickit.authorize()
}
