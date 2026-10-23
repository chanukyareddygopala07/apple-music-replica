/** Search view — query field, tabs, grouped results, empty states. */

import { search } from '@/data/catalog'
import { artistName, albumArtist, artistById } from '@/data/catalog-helpers'
import type { SearchResults } from '@/domain/types'
import { attachArtworkFallback, debounce, escapeHtml, on, qs, artImg } from '@/ui/el'
import { icon } from '@/ui/icons'
import { albumCardHtml, emptyStateHtml, mediaCardHtml, playlistCardHtml, skeletonRowsHtml, songRowHtml } from '@/ui/media'
import { GENRES } from '@/data/demo-catalog'
import { gradientCss } from '@/utils/artwork'

type Tab = 'top' | 'songs' | 'albums' | 'artists' | 'playlists'

export async function renderSearch(root: HTMLElement, initialQuery: string): Promise<void> {
  root.innerHTML = `
    <div style="padding:24px 40px 8px" class="search-head">
      <div class="search-pill-wrap">
        <div class="search-pill" role="search">
          ${icon('search')}
          <input type="search" id="search-input" placeholder="Artists, songs, albums, playlists" autocomplete="off" aria-label="Search catalogue" value="${escapeHtml(initialQuery)}" />
          <button type="button" class="icon-btn clear-btn" data-action="search-clear" aria-label="Clear search">${icon('close')}</button>
        </div>
      </div>
    </div>
    <div id="search-body"></div>`

  const input = qs<HTMLInputElement>('#search-input', root)!
  const body = qs<HTMLElement>('#search-body', root)!
  if (!input || !body) return

  let currentQuery = initialQuery
  let currentTab: Tab = 'top'
  let seq = 0

  const categoriesHtml = () => `
    <div class="section-header"><h2 class="section-title">Browse Categories</h2></div>
    <div class="category-grid">
      ${GENRES.map(
        (g) => `
        <a class="category-card" href="/genre/${escapeHtml(g.id)}" data-nav>
          <span class="cat-wash" style="background:${gradientCss(g.id)}" aria-hidden="true"></span>
          <span class="cat-label">${escapeHtml(g.name)}</span>
        </a>`,
      ).join('')}
    </div>`

  const idleHtml = () => `<h1 class="page-title">Search</h1>${categoriesHtml()}`

  async function runSearch(q: string): Promise<void> {
    const mySeq = ++seq
    if (!q.trim()) {
      body.innerHTML = idleHtml()
      return
    }
    body.innerHTML = `<div style="padding:0 40px">${skeletonRowsHtml(5)}</div>`
    const results: SearchResults = await search(q)
    if (mySeq !== seq) return
    renderResults(results)
  }

  function renderResults(r: SearchResults): void {
    const total = r.songs.length + r.albums.length + r.artists.length + r.playlists.length
    if (total === 0) {
      body.innerHTML = `${emptyStateHtml('search', `No results for “${r.query}”`, 'Try a different spelling, artist or song title.')}`
      return
    }

    const tabs: Array<{ id: Tab; label: string }> = [
      { id: 'top', label: 'Top' },
      { id: 'songs', label: 'Songs' },
      { id: 'albums', label: 'Albums' },
      { id: 'artists', label: 'Artists' },
      { id: 'playlists', label: 'Playlists' },
    ]

    const top = r.songs[0] ?? r.artists[0] ? { song: r.songs[0], artist: r.artists[0] } : null
    const topHtml = () => {
      if (!top) return ''
      if (top.song) {
        const s = top.song
        return `
        <div class="top-result">
          ${artImg(`album-${s.albumId}`, s.title)}
          <div>
            <div class="tr-kicker">Song</div>
            <div class="tr-title">${escapeHtml(s.title)}</div>
            <div class="tr-sub">${escapeHtml(artistName(s.artistIds[0]))}</div>
          </div>
          <button type="button" class="play-circle" data-action="play-song" data-song-id="${escapeHtml(s.id)}" aria-label="Play ${escapeHtml(s.title)}">${icon('play')}</button>
        </div>`
      }
      if (top.artist) {
        const a = top.artist
        return `
        <div class="top-result">
          ${artImg(artistById(a.id)?.artworkSeed ?? a.artworkSeed, a.name, '', { round: true })}
          <div>
            <div class="tr-kicker">Artist</div>
            <div class="tr-title">${escapeHtml(a.name)}</div>
            <div class="tr-sub">Artist</div>
          </div>
          <a class="btn btn-secondary" href="/artist/${escapeHtml(a.id)}" data-nav>View</a>
        </div>`
      }
      return ''
    }

    const songsHtml = r.songs.length
      ? `<div class="list-rows" data-song-list role="list">${r.songs.slice(0, currentTab === 'songs' ? 25 : 5).map((s) => songRowHtml(s, { context: 'search' })).join('')}</div>`
      : ''
    const albumsHtml = r.albums.length
      ? `<div class="media-grid">${r.albums.slice(0, currentTab === 'albums' ? 16 : 6).map((a) => albumCardHtml(a, albumArtist(a))).join('')}</div>`
      : ''
    const artistsHtml = r.artists.length
      ? `<div class="media-grid">${r.artists
          .slice(0, currentTab === 'artists' ? 12 : 6)
          .map((a) =>
            mediaCardHtml({ id: a.id, title: a.name, sub: 'Artist', seed: artistById(a.id)?.artworkSeed ?? a.artworkSeed, href: `/artist/${a.id}` }),
          )
          .join('')}</div>`
      : ''
    const playlistsHtml = r.playlists.length
      ? `<div class="media-grid">${r.playlists.slice(0, currentTab === 'playlists' ? 12 : 4).map((p) => playlistCardHtml(p)).join('')}</div>`
      : ''

    const bodyForTab = (): string => {
      switch (currentTab) {
        case 'songs':
          return songsHtml || emptyStateHtml('search', 'No songs', 'Try another query.')
        case 'albums':
          return albumsHtml || emptyStateHtml('search', 'No albums', 'Try another query.')
        case 'artists':
          return artistsHtml || emptyStateHtml('search', 'No artists', 'Try another query.')
        case 'playlists':
          return playlistsHtml || emptyStateHtml('search', 'No playlists', 'Try another query.')
        default:
          return `
            ${topHtml()}
            ${r.songs.length ? `<div class="section-header"><h2 class="section-title">Songs</h2></div>${songsHtml}` : ''}
            ${r.artists.length ? `<div class="section-header"><h2 class="section-title">Artists</h2></div>${artistsHtml}` : ''}
            ${r.albums.length ? `<div class="section-header"><h2 class="section-title">Albums</h2></div>${albumsHtml}` : ''}
            ${r.playlists.length ? `<div class="section-header"><h2 class="section-title">Playlists</h2></div>${playlistsHtml}` : ''}`
      }
    }

    body.innerHTML = `
      <h1 class="page-title">Search</h1>
      <div class="tabs-row" role="tablist" aria-label="Search result filters">
        ${tabs.map((t) => `<button type="button" class="chip" role="tab" aria-selected="${t.id === currentTab}" data-tab="${t.id}">${t.label}</button>`).join('')}
      </div>
      <div id="search-tab-body">${bodyForTab()}</div>`
    attachArtworkFallback(body)

    body.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        currentTab = (btn.getAttribute('data-tab') as Tab) ?? 'top'
        renderResults(r)
      })
    })
  }

  const debounced = debounce((q: string) => {
    currentQuery = q
    const url = q ? `/search?q=${encodeURIComponent(q)}` : '/search'
    window.history.replaceState(null, '', url)
    void runSearch(q)
  }, 220)

  input.addEventListener('input', () => debounced(input.value))
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') {
      ev.preventDefault()
      currentQuery = input.value
      window.history.replaceState(null, '', currentQuery ? `/search?q=${encodeURIComponent(currentQuery)}` : '/search')
      void runSearch(currentQuery)
    }
  })
  on(root, 'click', '[data-action="search-clear"]', () => {
    input.value = ''
    input.focus()
    debounced('')
  })

  if (initialQuery) void runSearch(initialQuery)
  else body.innerHTML = idleHtml()
  input.focus()
}
