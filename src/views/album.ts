/** Album detail view — themed hero + track list + related. */

import type { Album, Song } from '@/domain/types'
import { getCatalog, albumArtist, artistName } from '@/data/catalog-helpers'
import { artistAnchorHtml, attachArtworkFallback, on } from '@/ui/el'
import { icon } from '@/ui/icons'
import { albumCardHtml, carouselWrapHtml, emptyStateHtml, songRowHtml, applyHeroTheme } from '@/ui/media'
import { formatDate, formatDurationLong, formatSongCount } from '@/utils/format'
import { wireCarousels } from '@/views/home'
import { isFavoriteAlbum, toggleAlbumFavorite } from '@/state/library-store'

export async function renderAlbum(root: HTMLElement, id: string): Promise<void> {
  root.innerHTML = `<div class="page-title" style="opacity:.4">Loading album…</div>`
  const catalog = getCatalog()
  const album: Album | null = await catalog.getAlbum(id)
  if (!album) {
    root.innerHTML = emptyStateHtml('note', 'Album not found', 'It may have been removed from the demo catalogue.')
    return
  }
  const songs = await catalog.getSongsByAlbum(album.id)
  const artist = await catalog.getArtist(album.artistId)
  const moreBy = (await catalog.getAlbumsByArtist(album.artistId)).filter((a) => a.id !== album.id).slice(0, 10)
  const totalMs = songs.reduce((sum, s) => sum + s.durationMs, 0)

  root.classList.add('theme-page')
  applyHeroTheme(root, album.artworkSeed)

  root.innerHTML = `
    <div class="detail-hero">
      <img class="hero-art" src="" data-seed="${album.artworkSeed}" alt="Cover of ${album.title.replaceAll('"', '')}" />
      <div class="hero-info">
        <div class="hero-kicker">${album.kind === 'ep' ? 'EP' : album.kind === 'single' ? 'Single' : 'Album'}</div>
        <h1>${album.title.replaceAll('<', '&lt;')}</h1>
        <div class="hero-byline">${artistAnchorHtml(albumArtist(album), album.artistId)}</div>
        <div class="hero-meta">${album.genreIds.length ? album.genreIds[0]?.replace('g-', '').replaceAll('-', ' ') : ''} · ${album.releaseDate.slice(0, 4)}</div>
        ${album.description ? `<p class="hero-desc">${album.description.replaceAll('<', '&lt;')}</p>` : ''}
        <div class="hero-actions">
          <button type="button" class="btn btn-play-hero" data-action="play-context" data-kind="album" data-id="${album.id}">
            ${icon('play')} Play
          </button>
          <button type="button" class="btn btn-secondary" data-action="play-context" data-kind="album" data-id="${album.id}" data-shuffle="true">
            ${icon('shuffle')} Shuffle
          </button>
          <button type="button" class="icon-btn lg on-theme fav-album" data-action="fav-album" data-album-id="${album.id}" aria-label="Add album to library">${icon('heart')}</button>
        </div>
      </div>
    </div>
    <div class="track-list" data-song-list role="list" aria-label="Tracks on ${album.title.replaceAll('"', '')}">
      ${songs.map((s: Song, i: number) => songRowHtml(s, { index: i, context: `album:${album.id}` })).join('')}
    </div>
    <div class="album-footer-meta">
      <div>${formatDate(album.releaseDate)}</div>
      <div>${formatSongCount(songs.length)}, ${formatDurationLong(totalMs)}</div>
      ${album.copyright ? `<div>${album.copyright.replaceAll('<', '&lt;')}</div>` : ''}
      ${album.label ? `<div>${album.label.replaceAll('<', '&lt;')}</div>` : ''}
    </div>
    ${artist ? `<div class="hero-meta" style="padding:0 40px 16px">More by <a href="/artist/${artist.id}" data-nav style="text-decoration:underline">${artistName(artist.id)}</a></div>` : ''}
    ${moreBy.length ? carouselWrapHtml(moreBy.map((a) => albumCardHtml(a, albumArtist(a))).join('')) : ''}
    <div style="height:32px"></div>
  `
  attachArtworkFallback(root)
  wireCarousels(root)
  refreshAlbumFav(root)

  on(root, 'click', '[data-action="fav-album"]', () => {
    toggleAlbumFavorite(album.id)
    refreshAlbumFav(root)
  })
}

function refreshAlbumFav(root: HTMLElement): void {
  const btn = root.querySelector<HTMLButtonElement>('[data-action="fav-album"]')
  const albumId = btn?.getAttribute('data-album-id')
  if (!btn || !albumId) return
  const fav = isFavoriteAlbum(albumId)
  btn.innerHTML = icon(fav ? 'heart-fill' : 'heart')
  btn.setAttribute('aria-pressed', String(fav))
  btn.style.color = fav ? '#fff' : ''
}
