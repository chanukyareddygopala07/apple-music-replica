/** Artist view — hero image, top songs, albums. */

import type { Album, Artist, Song } from '@/domain/types'
import { getCatalog } from '@/data/catalog-helpers'
import { attachArtworkFallback } from '@/ui/el'
import { icon } from '@/ui/icons'
import { albumCardHtml, carouselWrapHtml, emptyStateHtml, sectionHeaderHtml, songRowHtml, applyHeroTheme } from '@/ui/media'
import { artworkDataUrl } from '@/utils/artwork'
import { wireCarousels } from '@/views/home'

export async function renderArtist(root: HTMLElement, id: string): Promise<void> {
  root.innerHTML = `<div class="page-title" style="opacity:.4">Loading artist…</div>`
  const catalog = getCatalog()
  const artist: Artist | null = await catalog.getArtist(id)
  if (!artist) {
    root.innerHTML = emptyStateHtml('search', 'Artist not found', 'This artist isn’t part of the demo catalogue.')
    return
  }
  const topSongs = await catalog.getTopSongsByArtist(artist.id)
  const albums = await catalog.getAlbumsByArtist(artist.id)
  const latest: Album | undefined = albums[0]

  root.classList.add('theme-page')
  applyHeroTheme(root, latest?.id ? `album-${latest.id}` : artist.id)

  root.innerHTML = `
    <header class="artist-hero">
      <img class="artist-bg" src="${artworkDataUrl(artist.artworkSeed)}" alt="" aria-hidden="true" />
      <div class="artist-shade" aria-hidden="true"></div>
      <h1>${artist.name.replaceAll('<', '&lt;')}</h1>
      <div class="artist-actions">
        <button type="button" class="play-circle" data-action="play-context" data-kind="artist" data-id="${artist.id}" aria-label="Play ${artist.name.replaceAll('"', '')}">${icon('play')}</button>
        <button type="button" class="artist-meta-circle" data-action="play-context" data-kind="artist" data-id="${artist.id}" data-shuffle="true" aria-label="Shuffle ${artist.name.replaceAll('"', '')}">${icon('shuffle')}</button>
      </div>
    </header>
    <div class="artist-body">
      ${artist.bio ? `<p class="hero-desc" style="padding:0 40px 20px;max-width:720px">${artist.bio.replaceAll('<', '&lt;')}</p>` : ''}
      <div class="artist-top-grid">
        ${latest ? `
          <section aria-label="Latest release">
            <div class="section-header" style="padding-left:0"><h2 class="section-title">Latest Release</h2></div>
            <div class="latest-release">
              <a href="/album/${latest.id}" data-nav><img src="${artworkDataUrl(latest.artworkSeed)}" alt="Cover of ${latest.title.replaceAll('"', '')}" /></a>
              <div class="lr-meta">
                <div>${latest.releaseDate.slice(0, 11)}</div>
                <a class="lr-title" href="/album/${latest.id}" data-nav style="display:block">${latest.title.replaceAll('<', '&lt;')}</a>
                <div>${latest.songIds.length} songs</div>
              </div>
            </div>
          </section>` : ''}
        <section aria-label="Top songs">
          <div class="section-header" style="padding-left:0"><h2 class="section-title">Top Songs</h2></div>
          <div class="song-grid" data-song-list role="list">
            ${topSongs.map((s: Song) => songRowHtml(s, { context: `artist:${artist.id}` })).join('')}
          </div>
        </section>
      </div>
      ${albums.length ? `${sectionHeaderHtml('Albums')}${carouselWrapHtml(albums.map((a) => albumCardHtml(a, artist.name)).join(''))}` : ''}
    </div>`
  attachArtworkFallback(root)
  wireCarousels(root)
}
