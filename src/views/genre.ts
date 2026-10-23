/** Genre page — songs + albums for one genre. */

import { getCatalog, artistName } from '@/data/catalog-helpers'
import { attachArtworkFallback } from '@/ui/el'
import { albumCardHtml, emptyStateHtml, sectionHeaderHtml, songRowHtml } from '@/ui/media'
import { wireCarousels } from '@/views/home'
import type { Album, Genre, Song } from '@/domain/types'

export async function renderGenre(root: HTMLElement, id: string): Promise<void> {
  root.innerHTML = `<h1 class="page-title">Genre</h1>`
  const catalog = getCatalog()
  const genre: Genre | null = await catalog.getGenre(id)
  if (!genre) {
    root.innerHTML = emptyStateHtml('browse', 'Genre not found', 'Try browsing categories instead.')
    return
  }
  // Collect songs + albums whose genreIds include this genre via albums list.
  const allAlbums = (await catalog.getBrowse()).newReleases
  const albums = allAlbums.filter((a) => a.genreIds.includes(genre.id))
  const songsByAlbum = await Promise.all(albums.map((a) => catalog.getSongsByAlbum(a.id)))
  const songs: Song[] = songsByAlbum.flat().slice(0, 16)

  root.innerHTML = `
    <h1 class="page-title">${genre.name}</h1>
    ${
      songs.length
        ? `${sectionHeaderHtml(`Top ${genre.name}`)}
           <div class="song-grid" data-song-list role="list">${songs.map((s) => songRowHtml(s, { context: `genre-${genre.id}` })).join('')}</div>`
        : ''
    }
    ${albums.length ? `${sectionHeaderHtml('Albums')}<div class="media-grid">${albums.map((a: Album) => albumCardHtml(a, artistName(a.artistId))).join('')}</div>` : ''}
    ${!songs.length && !albums.length ? emptyStateHtml('browse', 'Nothing here yet', 'This genre has no demo releases.') : ''}
  `
  attachArtworkFallback(root)
  wireCarousels(root)
}
