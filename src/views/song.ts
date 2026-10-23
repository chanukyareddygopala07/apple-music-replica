/** Song detail view. */

import type { Song } from '@/domain/types'
import { getCatalog, artistNamesFor, albumArtist } from '@/data/catalog-helpers'
import { attachArtworkFallback } from '@/ui/el'
import { icon } from '@/ui/icons'
import { albumCardHtml, carouselWrapHtml, emptyStateHtml, sectionHeaderHtml, songRowHtml, applyHeroTheme } from '@/ui/media'
import { formatTime } from '@/utils/format'
import { isFavoriteSong } from '@/state/library-store'

export async function renderSong(root: HTMLElement, id: string): Promise<void> {
  root.innerHTML = `<div class="page-title" style="opacity:.4">Loading…</div>`
  const catalog = getCatalog()
  const song: Song | null = await catalog.getSong(id)
  if (!song) {
    root.innerHTML = emptyStateHtml('search', 'Song not found', 'This track isn’t in the demo catalogue.')
    return
  }
  const album = await catalog.getAlbum(song.albumId)
  const artistId = song.artistIds[0]
  const artist = artistId ? await catalog.getArtist(artistId) : null
  const relatedAlbums = artist ? (await catalog.getAlbumsByArtist(artist.id)).filter((a) => a.id !== song.albumId).slice(0, 10) : []
  const fav = isFavoriteSong(song.id)

  root.classList.add('theme-page')
  applyHeroTheme(root, album?.artworkSeed ?? song.id)

  root.innerHTML = `
    <div class="detail-hero">
      <img class="hero-art" src="" data-seed="${album?.artworkSeed ?? song.id}" alt="" />
      <div class="hero-info">
        <div class="hero-kicker">Song</div>
        <h1>${song.title.replaceAll('<', '&lt;')}${song.explicit ? '<span class="explicit-badge" style="vertical-align:middle">E</span>' : ''}</h1>
        <div class="hero-byline"><a href="/artist/${artist?.id ?? ''}" data-nav>${artistNamesFor(song).replaceAll('<', '&lt;')}</a></div>
        <div class="hero-meta">
          <a href="/album/${song.albumId}" data-nav style="text-decoration:underline">${(album?.title ?? 'Unknown album').replaceAll('<', '&lt;')}</a>
          · ${formatTime(song.durationMs)}
        </div>
        <div class="hero-actions">
          <button type="button" class="btn btn-play-hero" data-action="play-song" data-song-id="${song.id}">${icon('play')} Play</button>
          <button type="button" class="btn btn-secondary" data-action="enqueue-song" data-song-id="${song.id}">${icon('queue')} Queue</button>
          <button type="button" class="icon-btn lg on-theme" data-action="fav-song" data-song-id="${song.id}" aria-pressed="${fav}" aria-label="Favorite">${icon(fav ? 'heart-fill' : 'heart')}</button>
        </div>
      </div>
    </div>
    ${
      album
        ? `<div class="section-header"><a class="section-title" href="/album/${album.id}" data-nav>From the album ${album.title.replaceAll('<', '&lt;')} ${icon('chevron-right')}</a></div>
           <div class="list-rows" data-song-list role="list">${(await catalog.getSongsByAlbum(album.id)).map((s) => songRowHtml(s, { context: `album:${album.id}` })).join('')}</div>`
        : ''
    }
    ${relatedAlbums.length ? `${sectionHeaderHtml('More by ' + (artist?.name ?? 'artist'))}${carouselWrapHtml(relatedAlbums.map((a) => albumCardHtml(a, albumArtist(a))).join(''))}` : ''}
    <div style="height:40px"></div>`
  attachArtworkFallback(root)
}
