/** Home view — editorial features, multilingual discovery shelves, song grids. */

import type { HomeFeed, Song } from '@/domain/types'
import { getCatalog, artistName } from '@/data/catalog-helpers'
import { HOME_DISCOVERY_QUERY, discoverHomeYouTube, type HomeDiscoveryResult } from '@/data/home-discovery'
import { rememberDiscoveredSongs, shelvesByLanguage, type LanguageShelf } from '@/data/discovery-pool'
import { libraryStore } from '@/state/library-store'
import { attachArtworkFallback, artImg, escapeHtml, on } from '@/ui/el'
import { icon } from '@/ui/icons'
import {
  albumCardHtml,
  carouselWrapHtml,
  emptyStateHtml,
  playlistCardHtml,
  sectionHeaderHtml,
  skeletonCardsHtml,
  skeletonRowsHtml,
  songRowHtml,
  youtubeCardHtml,
} from '@/ui/media'
import { clampedGradientCss } from '@/utils/artwork'

/**
 * Stale-response guard: a newer Home render (or a retry) supersedes any
 * in-flight discovery fill, so an older response can never overwrite a
 * newer one (search view's sequence pattern, data/search.ts).
 */
let discoverySeq = 0

const RETRY_BUTTON = `<button type="button" class="btn btn-secondary" data-action="home-discovery-retry">Retry</button>`

export async function renderHome(root: HTMLElement): Promise<void> {
  root.innerHTML = `
    <h1 class="page-title">Home</h1>
    <div class="skeleton" style="height:300px;margin:0 40px;border-radius:10px" aria-hidden="true"></div>
    <div style="padding:32px 0">${skeletonRowsHtml(4)}</div>`

  // Warm the single session discovery request in parallel with the feed
  // fetch; fillDiscovery joins THIS promise (one request for the initial
  // render even when discovery settles before the feed arrives).
  const discovery = discoverHomeYouTube()
  void discovery.catch(() => undefined)

  const feed: HomeFeed = await getCatalog().getHome()
  const recentIds = libraryStore.get().recentlyPlayed.slice(0, 10).map((e) => e.songId)
  const recentSongs = (
    await Promise.all(recentIds.map((id) => getCatalog().getSong(id)))
  ).filter((s): s is Song => Boolean(s))
  const recentAlbumIds = libraryStore.get().recentlyAddedAlbumIds.slice(0, 10)
  const recentAlbums = (
    await Promise.all(recentAlbumIds.map((id) => getCatalog().getAlbum(id)))
  ).filter((a): a is NonNullable<typeof a> => Boolean(a))

  // Language-bearing feed tracks join the session pool (no-op when the feed
  // carries no languages) so shelves can also come from what Home already shows.
  rememberDiscoveredSongs([...feed.bestNewSongs, ...feed.topCharts])

  const featuresHtml = feed.features
    .map(
      (f) => `
      <a class="editorial-card" href="${escapeHtml(f.href)}" data-nav
        style="background:${clampedGradientCss(f.artworkSeed)}">
        <div class="eyebrow">${escapeHtml(f.eyebrow)}</div>
        <div class="ed-title">${escapeHtml(f.title)}</div>
        <div class="ed-sub">${escapeHtml(f.subtitle)}</div>
        <span class="ed-cta">${icon('play')}Listen now</span>
        <div class="ed-art" aria-hidden="true">
          <svg class="ed-burst" viewBox="0 0 100 100" fill="currentColor" aria-hidden="true">
            <polygon points="50.0 2.0 56.5 25.9 74.0 8.4 67.7 32.3 91.6 26.0 74.1 43.5 98.0 50.0 74.1 56.5 91.6 74.0 67.7 67.7 74.0 91.6 56.5 74.1 50.0 98.0 43.5 74.1 26.0 91.6 32.3 67.7 8.4 74.0 25.9 56.5 2.0 50.0 25.9 43.5 8.4 26.0 32.3 32.3 26.0 8.4 43.5 25.9" />
          </svg>
          <div class="ed-media">${artImg(f.artworkSeed, f.title)}${
            f.caption ? `<div class="ed-caption">${escapeHtml(f.caption)}</div>` : ''
          }</div>
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
      <div data-home-discovery>
        <div data-lang-section>${discoverySkeletonHtml('Explore by Language')}</div>
        <div data-yt-section>${discoverySkeletonHtml('YouTube Music')}</div>
      </div>
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

  // Home's first paint never waits on discovery: the feed above renders, the
  // two discovery sections fill in place (skeleton → content/state) after the
  // bounded request settles; retries re-run only the discovery fill.
  on(root, 'click', '[data-action="home-discovery-retry"]', () => {
    void fillDiscovery(root, ++discoverySeq) // retry: fresh request (failures never cache)
  })
  void fillDiscovery(root, ++discoverySeq, discovery)
}

function discoverySkeletonHtml(title: string): string {
  return `${sectionHeaderHtml(title)}${carouselWrapHtml(skeletonCardsHtml(5))}`
}

/**
 * Render the discovery sections once a discovery has settled. The initial
 * render passes the warm request so the fill reuses it; a retry omits it and
 * runs a fresh (single-flight) search.
 */
async function fillDiscovery(
  root: HTMLElement,
  seq: number,
  pending: Promise<HomeDiscoveryResult> = discoverHomeYouTube(),
): Promise<void> {
  let result: HomeDiscoveryResult
  try {
    result = await pending
  } catch {
    // Cancellation is the only rejection source; an honest retryable state.
    result = { status: 'error', songs: [], message: 'YouTube search could not be completed.' }
  }
  if (seq !== discoverySeq) return // superseded by a newer render/retry
  const langSlot = root.querySelector<HTMLElement>('[data-lang-section]')
  const ytSlot = root.querySelector<HTMLElement>('[data-yt-section]')
  if (!langSlot || !ytSlot) return // navigated away from Home meanwhile

  // Explore by Language: shelves from the session pool (the discovery result
  // was ingested by discoverHomeYouTube) — hidden entirely when none exist.
  const shelves = shelvesByLanguage()
  langSlot.innerHTML = shelves.length > 0 ? langSectionHtml(shelves) : ''
  if (shelves.length > 0) {
    attachArtworkFallback(langSlot)
    wireCarousels(langSlot)
  }

  ytSlot.innerHTML = ytSectionHtml(result)
  attachArtworkFallback(ytSlot)
  wireCarousels(ytSlot)
}

function langSectionHtml(shelves: LanguageShelf[]): string {
  return `<div class="section-header"><h2 class="section-title">Explore by Language</h2></div>${shelves
    .map(langShelfHtml)
    .join('')}`
}

function langShelfHtml(shelf: LanguageShelf): string {
  const rows = shelf.songs.map((s) => songRowHtml(s, { context: `home-lang-${shelf.code}` })).join('')
  return `
    <section class="lang-shelf" data-language="${escapeHtml(shelf.code)}"
      aria-label="${escapeHtml(`${shelf.label} songs`)}">
      ${sectionHeaderHtml(`${shelf.label} Songs`, exploreHref(shelf))}
      ${carouselWrapHtml(rows, 'data-song-list role="list"')}
    </section>`
}

/**
 * "See All" explore link: Search with this shelf's language applied and the
 * discovery query prefilled. A single-source shelf pins that source so the
 * landing view shows exactly what the shelf showed.
 */
function exploreHref(shelf: LanguageShelf): string {
  const sources = [
    ...new Set(
      shelf.songs.map((s) => s.source).filter((s): s is NonNullable<Song['source']> => Boolean(s) && s !== 'demo'),
    ),
  ]
  const src = sources.length === 1 && sources[0] ? `&src=${encodeURIComponent(sources[0])}` : ''
  return `/search?q=${encodeURIComponent(HOME_DISCOVERY_QUERY)}&lang=${encodeURIComponent(shelf.code)}${src}`
}

function ytSectionHtml(result: HomeDiscoveryResult): string {
  const header = sectionHeaderHtml('YouTube Music')
  switch (result.status) {
    case 'ok':
      return `${header}${carouselWrapHtml(result.songs.map((s) => youtubeCardHtml(s)).join(''))}`
    case 'empty':
      return `${header}${emptyStateHtml(
        'note',
        'No YouTube videos right now',
        'YouTube returned no videos for the Home discovery. Try again in a moment.',
      )}`
    case 'error':
      return `${header}${emptyStateHtml(
        'alert',
        'YouTube search is unavailable',
        result.message ?? 'YouTube search could not be completed.',
        RETRY_BUTTON,
      )}`
    default:
      return `${header}${emptyStateHtml(
        'info',
        'YouTube search is not connected',
        result.message ?? 'YouTube discovery is not available in this build.',
      )}`
  }
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
