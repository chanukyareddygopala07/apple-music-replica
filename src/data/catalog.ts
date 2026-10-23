/**
 * Catalogue facade. UI always talks to this module, never to a concrete
 * provider — so a real provider (e.g. MusicKit) can be swapped in later.
 *
 * Default: demo catalogue (no credentials). When the MusicKit two-key gate
 * passes (VITE_MUSICKIT_ENABLED + a token source — see data/musickit-token.ts),
 * MusicKit is attempted for *search only*; any failure falls back to the demo
 * catalogue transparently.
 */

import type { CatalogProvider, CatalogProviderInfo, SearchResults } from '@/domain/types'
import { DemoCatalogProvider } from '@/data/demo-provider'
import { MusicKitProvider, isMusicKitConfigured } from '@/data/musickit-provider'

const demo = new DemoCatalogProvider()
const musickit = new MusicKitProvider()

export const catalog: CatalogProvider = demo

export function providerInfos(): CatalogProviderInfo[] {
  return [demo.info, musickit.info]
}

export async function search(query: string): Promise<SearchResults> {
  const local = await demo.search(query)
  if (!isMusicKitConfigured()) return local
  try {
    const remote = await musickit.search(query)
    // Merge MusicKit hits ahead of local matches when available.
    return {
      query,
      songs: [...remote.songs, ...local.songs].slice(0, 30),
      albums: [...remote.albums, ...local.albums].slice(0, 20),
      artists: [...remote.artists, ...local.artists].slice(0, 12),
      playlists: local.playlists,
    }
  } catch {
    return local
  }
}

export async function authorizeAppleMusic(): Promise<{ ok: boolean; message: string }> {
  return musickit.authorize()
}
