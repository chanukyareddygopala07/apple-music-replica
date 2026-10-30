/** Demo CatalogProvider backed by the local curated catalogue. */

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
import { ALBUMS, ARTISTS, GENRES, PLAYLISTS, SONGS, STATIONS } from '@/data/demo-catalog'

const byId = <T extends { id: string }>(items: T[]) => new Map(items.map((i) => [i.id, i]))

const songMap = byId(SONGS)
const albumMap = byId(ALBUMS)
const artistMap = byId(ARTISTS)
const playlistMap = byId(PLAYLISTS)
const stationMap = byId(STATIONS)
const genreMap = byId(GENRES)

function songsOfAlbum(albumId: string): Song[] {
  return SONGS.filter((s) => s.albumId === albumId)
}

function artistName(id: string): string {
  return artistMap.get(id)?.name ?? 'Unknown Artist'
}

export class DemoCatalogProvider implements CatalogProvider {
  readonly info: CatalogProviderInfo = {
    id: 'demo',
    name: 'Demo catalogue',
    description: 'Original fictional metadata with freely licensed demo audio (SoundHelix) and generated artwork.',
    configured: true,
  }

  async getHome(): Promise<HomeFeed> {
    const byDate = [...ALBUMS].sort((a, b) => b.releaseDate.localeCompare(a.releaseDate))
    return {
      features: [
        {
          id: 'feat-night-drive',
          eyebrow: 'Station',
          title: 'Night Drive Radio',
          subtitle: 'Synth glow for the long way home.',
          caption: 'Endless rotation of Neon Harbor, Kite Theory and friends.',
          artworkSeed: 'st-night-drive',
          href: '/radio',
        },
        {
          id: 'feat-deep-focus',
          eyebrow: 'Playlist',
          title: 'Deep Focus',
          subtitle: 'Keep the room quiet and the work moving.',
          caption: 'Long-form instrumentals, hand-picked.',
          artworkSeed: 'pl-deep-focus',
          href: '/playlist/pl-deep-focus',
        },
        {
          id: 'feat-tidal-lines',
          eyebrow: 'New Album',
          title: 'Tidal Lines — Neon Harbor',
          subtitle: 'Synthpop for the last ferry home.',
          caption: 'Out now on Realaxify Demo Records.',
          artworkSeed: 'album-al-tidal-lines',
          href: '/album/al-tidal-lines',
        },
      ],
      bestNewSongs: ['s-mg-1', 's-tl-1', 's-mh-1', 's-bk-1', 's-ps-1', 's-gh-1', 's-lt-1', 's-ss-1', 's-fn-2', 's-mh-2', 's-bk-2', 's-tl-3']
        .map((id) => songMap.get(id))
        .filter((s): s is Song => Boolean(s)),
      newThisWeek: byDate.slice(0, 8),
      madeForYou: PLAYLISTS.slice(0, 6),
      topCharts: ['s-mg-1', 's-tl-1', 's-gh-1', 's-bk-1', 's-mh-1', 's-ss-2', 's-fn-1', 's-lt-1', 's-ps-1', 's-sw-1']
        .map((id) => songMap.get(id))
        .filter((s): s is Song => Boolean(s)),
      recentReleases: byDate.slice(0, 10),
    }
  }

  async getBrowse(): Promise<BrowseData> {
    const byDate = [...ALBUMS].sort((a, b) => b.releaseDate.localeCompare(a.releaseDate))
    return {
      categories: GENRES,
      newReleases: byDate,
      topCharts: ['s-mg-1', 's-tl-1', 's-gh-1', 's-bk-1', 's-mh-1', 's-ss-2', 's-fn-1', 's-lt-1', 's-ps-1', 's-sw-1', 's-gh-3', 's-tl-4']
        .map((id) => songMap.get(id))
        .filter((s): s is Song => Boolean(s)),
      playlists: PLAYLISTS,
    }
  }

  async getStations(): Promise<Station[]> {
    return STATIONS
  }

  async getStation(id: string): Promise<Station | null> {
    return stationMap.get(id) ?? null
  }

  async search(query: string): Promise<SearchResults> {
    const q = query.trim().toLowerCase()
    if (!q) return { query, songs: [], albums: [], artists: [], playlists: [] }
    const score = (text: string): number => {
      const t = text.toLowerCase()
      if (t === q) return 0
      if (t.startsWith(q)) return 1
      if (t.split(/\s+/).some((w) => w.startsWith(q))) return 2
      if (t.includes(q)) return 3
      return 99
    }
    const pick = <T>(items: T[], text: (item: T) => string, limit: number): T[] =>
      items
        .map((item) => ({ item, s: score(text(item)) }))
        .filter((x) => x.s < 99)
        .sort((a, b) => a.s - b.s)
        .slice(0, limit)
        .map((x) => x.item)

    return {
      query,
      songs: pick(SONGS, (s) => `${s.title} ${artistName(s.artistIds[0]!)}`, 20),
      albums: pick(ALBUMS, (a) => `${a.title} ${artistName(a.artistId)}`, 12),
      artists: pick(ARTISTS, (a) => a.name, 8),
      playlists: pick(PLAYLISTS, (p) => `${p.title} ${p.description}`, 8),
    }
  }

  async getSong(id: string): Promise<Song | null> {
    return songMap.get(id) ?? null
  }

  async getAlbum(id: string): Promise<Album | null> {
    return albumMap.get(id) ?? null
  }

  async getArtist(id: string): Promise<Artist | null> {
    return artistMap.get(id) ?? null
  }

  async getPlaylist(id: string): Promise<Playlist | null> {
    return playlistMap.get(id) ?? null
  }

  async getGenre(id: string): Promise<Genre | null> {
    return genreMap.get(id) ?? null
  }

  async getSongsByAlbum(albumId: string): Promise<Song[]> {
    return songsOfAlbum(albumId)
  }

  async getAlbumsByArtist(artistId: string): Promise<Album[]> {
    return ALBUMS.filter((a) => a.artistId === artistId).sort((a, b) => b.releaseDate.localeCompare(a.releaseDate))
  }

  async getTopSongsByArtist(artistId: string): Promise<Song[]> {
    const albums = await this.getAlbumsByArtist(artistId)
    const ids = new Set(albums.flatMap((a) => a.songIds))
    return SONGS.filter((s) => ids.has(s.id)).slice(0, 8)
  }
}
