/** Home view — editorial features, song grids, album carousels. */

import type { HomeFeed, Song } from '@/domain/types'
import { getCatalog, artistName } from '@/data/catalog-helpers'
import { libraryStore } from '@/state/library-store'
import { attachArtworkFallback, escapeHtml, on } from '@/ui/el'
import {
  albumCardHtml,
  playlistCardHtml,
  sectionHeaderHtml,
  skeletonRowsHtml,
  songRowHtml,
  carouselWrapHtml,
} from '@/ui/media'
import { gradientCss } from '@/utils/artwork'

export async function renderHome(root: HTMLElement): Promise<void> {
  root.innerHTML = `
    <h1 class="page-title">Home</h1>
    <div class="skeleton" style="height:300px;margin:0 40px;border-radius:10px" aria-hidden="true"></div>
    <div style="padding:32px 0">${skeletonRowsHtml(4)}</div>`

  const feed: HomeFeed = await getCatalog().getHome()
  const recentIds = libraryStore.get().recentlyPlayed.slice(0, 10).map((e) => e.songId)
  const recentSongs = (
    await Promise.all(recentIds.map((id) => getCatalog().getSong(id)))
  ).filter((s): s is Song => Boolean(s))
  const recentAlbumIds = libraryStore.get().recentlyAddedAlbumIds.slice(0, 10)
  const recentAlbums = (
    await Promise.all(recentAlbumIds.map((id) => getCatalog().getAlbum(id)))
  ).filter((a): a is NonNullable<typeof a> => Boolean(a))

  const featuresHtml = feed.features
    .map(
      (f) => `
      <a class="editorial-card" href="${escapeHtml(f.href)}" data-nav>
        <div class="eyebrow">${escapeHtml(f.eyebrow)}</div>
        <div class="ed-title">${escapeHtml(f.title)}</div>
        <div class="ed-sub">${escapeHtml(f.subtitle)}</div>
        <div class="ed-media" style="background:${gradientCss(f.artworkSeed)}">
          ${f.caption ? `<div class="ed-caption">${escapeHtml(f.caption)}</div>` : ''}
        </div>
      </a>`,
    )
    .join('')

  const bestSongsHtml = `<div class="song-grid" data-song-list role="list">${
    feed.bestNewSongs.map((s) => songRowHtml(s, { context: 'home-best' })).join('')
  }</div>`

  const newWeekHtml = carouselWrapHtml(feed.newThisWeek.map((a) => albumCardHtml(a, artistName(a.artistId))).join(''))
  const madeForYouHtml = carouselWrapHtml(feed.madeForYou.map((p) => playlistCardHtml(p)).join(''))
  const recentRelHtml = carouselWrapHtml(feed.recentReleases.map((a) => albumCardHtml(a, artistName(a.artistId))).join(''))
  const chartsHtml = `<div class="song-grid" data-song-list role="list">${
    feed.topCharts.map((s) => songRowHtml(s, { context: 'home-charts' })).join('')
  }</div>`

  const recentHtml =
    recentSongs.length > 0
      ? `<div class="song-grid" data-song-list role="list">${recentSongs.map((s) => songRowHtml(s, { context: 'home-recent' })).join('')}</div>`
      : `<p class="page-subtitle" style="padding-top:0">Songs you play will show up here.</p>`

  const recentAlbumsHtml =
    recentAlbums.length > 0
      ? carouselWrapHtml(recentAlbums.map((a) => albumCardHtml(a, artistName(a.artistId))).join(''))
      : ''

  root.innerHTML = `
    <div class="view home-view">
      <h1 class="page-title">Home</h1>
      <div class="editorial-track" aria-label="Featured">${featuresHtml}</div>
      ${recentSongs.length ? `${sectionHeaderHtml('Recently Played')}${recentHtml}` : ''}
      ${sectionHeaderHtml('Best New Songs')}
      ${bestSongsHtml}
      ${sectionHeaderHtml('New This Week')}
      ${newWeekHtml}
      ${sectionHeaderHtml('Made for You', '/library?tab=playlists')}
      ${madeForYouHtml}
      ${sectionHeaderHtml('Top Charts')}
      ${chartsHtml}
      ${sectionHeaderHtml('Recent Releases')}
      ${recentRelHtml}
      ${recentAlbumsHtml ? `${sectionHeaderHtml('Recently Added')}${recentAlbumsHtml}` : ''}
    </div>`
  attachArtworkFallback(root)
  wireCarousels(root)
}

export function wireCarousels(root: HTMLElement): void {
  root.querySelectorAll('.carousel').forEach((carousel) => {
    const track = carousel.querySelector<HTMLElement>('.carousel-track')
    const prev = carousel.querySelector<HTMLButtonElement>('[data-side="prev"]')
    const next = carousel.querySelector<HTMLButtonElement>('[data-side="next"]')
    if (!track || !prev || !next) return
    const update = () => {
      prev.setAttribute('data-visible', String(track.scrollLeft > 8))
      next.setAttribute('data-visible', String(track.scrollLeft + track.clientWidth < track.scrollWidth - 8))
    }
    prev.addEventListener('click', () => track.scrollBy({ left: -track.clientWidth * 0.85, behavior: 'smooth' }))
    next.addEventListener('click', () => track.scrollBy({ left: track.clientWidth * 0.85, behavior: 'smooth' }))
    track.addEventListener('scroll', update, { passive: true })
    update()
  })
  on(root, 'error', 'img', () => {
    /* handled by attachArtworkFallback */
  })
}
