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
import { DemoCatalogProvider } from '@/data/demo-provider'
import { MusicKitProvider, isMusicKitConfigured } from '@/data/musickit-provider'
import { AudiusProvider, isAudiusConfigured } from '@/data/audius-provider'

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

  async search(query: string): Promise<SearchResults> {
    const local = await demo.search(query)

    let remote: SearchResults | null = null
    if (isAudiusConfigured()) {
      try {
        remote = await audius.search(query)
      } catch {
        remote = null
      }
    }

    let musicKit: SearchResults | null = null
    if (isMusicKitConfigured()) {
      try {
        musicKit = await musickit.search(query)
      } catch {
        musicKit = null
      }
    }

    if (!remote && !musicKit) return local
    // Remote hits come ahead of local matches (MusicKit ordering preserved).
    return {
      query,
      songs: [...(remote?.songs ?? []), ...(musicKit?.songs ?? []), ...local.songs].slice(0, 30),
      albums: [...(musicKit?.albums ?? []), ...local.albums].slice(0, 20),
      artists: [...(remote?.artists ?? []), ...(musicKit?.artists ?? []), ...local.artists].slice(0, 12),
      playlists: [...(remote?.playlists ?? []), ...local.playlists].slice(0, 12),
    }
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

export async function search(query: string): Promise<SearchResults> {
  return catalog.search(query)
}

export async function authorizeAppleMusic(): Promise<{ ok: boolean; message: string }> {
  return musickit.authorize()
}
