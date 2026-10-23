/** Favorite toggles shared by the player bar, song menus and detail pages. */

import { toggleFavoriteSong, toggleAlbumFavorite, isFavoriteSong, isFavoriteAlbum } from '@/state/library-store'
import { showToast } from '@/ui/toast'
import { songById } from '@/data/catalog-helpers'

export function toggleFavorite(songId: string): boolean {
  const now = toggleFavoriteSong(songId)
  const title = songById(songId)?.title ?? 'Song'
  showToast({ message: now ? `Added “${title}” to favorites` : `Removed “${title}” from favorites` })
  return now
}

export function toggleFavoriteWithFeedback(songId: string): boolean {
  return toggleFavorite(songId)
}

export { toggleAlbumFavorite, isFavoriteSong, isFavoriteAlbum }
