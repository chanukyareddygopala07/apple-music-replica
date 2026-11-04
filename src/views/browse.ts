/** Browse view — categories, new releases, charts, playlists. */

import { getCatalog, artistName } from '@/data/catalog-helpers'
import { attachArtworkFallback } from '@/ui/el'
import { clampedGradientCss } from '@/utils/artwork'
import { albumCardHtml, playlistCardHtml, sectionHeaderHtml, songRowHtml, carouselWrapHtml } from '@/ui/media'
import { wireCarousels } from '@/views/home'
import { escapeHtml } from '@/ui/el'

export async function renderBrowse(root: HTMLElement): Promise<void> {
  root.innerHTML = `<h1 class="page-title">Browse</h1><div class="media-grid">${Array.from({ length: 6 }, () => '<div class="skeleton" style="aspect-ratio:21/9;border-radius:10px"></div>').join('')}</div>`

  const data = await getCatalog().getBrowse()

  const categoriesHtml = data.categories
    .map(
      (g) => `
      <a class="category-card" href="/genre/${escapeHtml(g.id)}" data-nav aria-label="${escapeHtml(g.name)}">
        <span class="cat-wash" style="background:${clampedGradientCss(g.id)}" aria-hidden="true"></span>
        <span class="cat-label">${escapeHtml(g.name)}</span>
      </a>`,
    )
    .join('')

  root.innerHTML = `
    <h1 class="page-title">Browse</h1>
    ${sectionHeaderHtml('Browse Categories')}
    <div class="category-grid" style="margin-bottom:24px">${categoriesHtml}</div>
    ${sectionHeaderHtml('New Releases')}
    ${carouselWrapHtml(data.newReleases.map((a) => albumCardHtml(a, artistName(a.artistId))).join(''))}
    ${sectionHeaderHtml('Top Songs')}
    <div class="song-grid" data-song-list role="list">
      ${data.topCharts.map((s) => songRowHtml(s, { context: 'browse-charts' })).join('')}
    </div>
    ${sectionHeaderHtml('Featured Playlists')}
    <div class="media-grid">${data.playlists.map((p) => playlistCardHtml(p)).join('')}</div>
  `
  attachArtworkFallback(root)
  wireCarousels(root)
}
