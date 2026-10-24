/** Shared media UI: song rows, cards, carousels, skeletons, empty states. */

import type { Album, Playlist, Song } from '@/domain/types'
import { artistNamesFor, getCatalog } from '@/data/catalog-helpers'
import { sourceName } from '@/data/sources'
import { escapeHtml, artImg } from '@/ui/el'
import { icon, type IconName } from '@/ui/icons'
import { formatTime } from '@/utils/format'
import { heroColors } from '@/utils/artwork'

/** Source pill for provider-sourced rows — demo rows carry no `source`. */
function sourceBadgeHtml(song: Song): string {
  if (!song.source || song.source === 'demo') return ''
  const name = sourceName(song.source)
  return `<span class="source-badge" title="Source: ${escapeHtml(name)}">${escapeHtml(name)}</span>`
}

export function songRowHtml(song: Song, opts?: { index?: number; showArt?: boolean; context?: string; queueItemId?: string; draggable?: boolean }): string {
  const sub = artistNamesFor(song)
  const art = opts?.showArt === false ? '' : artImg(songArtSeed(song), song.title, 'row-art')
  const numCell =
    opts?.index !== undefined
      ? `<span class="row-num has-hint">${opts.index + 1}</span><span class="row-play-hint" aria-hidden="true">${icon('play')}</span>`
      : art
  return `
    <div class="song-row" role="row" tabindex="0" data-song-id="${escapeHtml(song.id)}"
      ${opts?.context ? `data-context="${escapeHtml(opts.context)}"` : ''}
      ${opts?.queueItemId ? `data-queue-item-id="${escapeHtml(opts.queueItemId)}"` : ''}
      ${opts?.draggable ? 'draggable="true"' : ''}>
      ${numCell}
      <div class="row-main">
        <div class="row-title">${escapeHtml(song.title)}${song.explicit ? '<span class="explicit-badge" title="Explicit" aria-label="Explicit">E</span>' : ''}${sourceBadgeHtml(song)}</div>
        <div class="row-sub">${escapeHtml(sub)}</div>
      </div>
      <span class="row-duration mono-num">${formatTime(song.durationMs)}</span>
      <button type="button" class="icon-btn row-more" data-action="song-menu" data-song-id="${escapeHtml(song.id)}"
        ${opts?.queueItemId ? `data-queue-item-id="${escapeHtml(opts.queueItemId)}"` : ''}
        aria-label="More options for ${escapeHtml(song.title)}">${icon('more')}</button>
    </div>`
}

/** Artwork seed for a song row/queue art: remote artwork URL when present. */
export function songArtSeed(song: Song): string {
  return song.artworkUrl ?? `album-${song.albumId}`
}

export function mediaCardHtml(
  item: { id: string; title: string; sub: string; seed: string; href: string },
  opts?: { playAction?: string; playData?: Record<string, string> },
): string {
  const dataAttrs = opts?.playData
    ? Object.entries(opts.playData)
        .map(([k, v]) => `data-${k}="${escapeHtml(v)}"`)
        .join(' ')
    : ''
  return `
    <a class="media-card" href="${escapeHtml(item.href)}" data-nav>
      <div class="art-wrap">
        ${artImg(item.seed, item.title)}
        ${
          opts?.playAction
            ? `<button type="button" class="card-play" data-action="${escapeHtml(opts.playAction)}" ${dataAttrs} aria-label="Play ${escapeHtml(item.title)}">${icon('play')}</button>`
            : ''
        }
      </div>
      <div class="card-title clamp-2">${escapeHtml(item.title)}</div>
      <div class="card-sub clamp-2">${escapeHtml(item.sub)}</div>
    </a>`
}

export function albumCardHtml(album: Album, artistName: string): string {
  return mediaCardHtml(
    { id: album.id, title: album.title, sub: artistName, seed: album.artworkSeed, href: `/album/${album.id}` },
    { playAction: 'play-context', playData: { kind: 'album', id: album.id } },
  )
}

export function playlistCardHtml(pl: Playlist): string {
  return mediaCardHtml(
    { id: pl.id, title: pl.title, sub: pl.curator ?? 'Sonora User', seed: pl.artworkSeed, href: `/playlist/${pl.id}` },
    { playAction: 'play-context', playData: { kind: 'playlist', id: pl.id } },
  )
}

export function sectionHeaderHtml(title: string, href?: string): string {
  const inner = `${escapeHtml(title)}${href ? icon('chevron-right') : ''}`
  return href
    ? `<div class="section-header"><a class="section-title" href="${escapeHtml(href)}" data-nav>${inner}</a></div>`
    : `<div class="section-header"><h2 class="section-title">${inner}</h2></div>`
}

export function carouselWrapHtml(trackInner: string): string {
  return `
    <div class="carousel">
      <button type="button" class="carousel-arrow" data-side="prev" aria-label="Scroll back">${icon('chevron-left')}</button>
      <div class="carousel-track">${trackInner}</div>
      <button type="button" class="carousel-arrow" data-side="next" aria-label="Scroll forward">${icon('chevron-right')}</button>
    </div>`
}

export function skeletonCardsHtml(n = 6): string {
  return Array.from({ length: n }, () => `
    <div class="skeleton-card skeleton" aria-hidden="true">
      <div class="sk-art"></div><div class="sk-line"></div><div class="sk-line short"></div>
    </div>`).join('')
}

export function skeletonRowsHtml(n = 6): string {
  return Array.from({ length: n }, () => `
    <div class="skeleton-row" aria-hidden="true">
      <div class="sk-art skeleton"></div>
      <div><div class="sk-line skeleton"></div><div class="sk-line short skeleton"></div></div>
    </div>`).join('')
}

export function emptyStateHtml(iconName: IconName, title: string, desc: string, actionHtml = ''): string {
  return `
    <div class="state-block">
      <div class="state-icon">${icon(iconName)}</div>
      <div class="state-title">${escapeHtml(title)}</div>
      <p class="state-desc">${escapeHtml(desc)}</p>
      ${actionHtml}
    </div>`
}

export async function resolveSongIds(ids: string[]): Promise<Song[]> {
  const songs = await Promise.all(ids.map((id) => getCatalog().getSong(id)))
  return songs.filter((s): s is Song => Boolean(s))
}

function relativeLuminance(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex)
  if (!m) return 0
  const n = parseInt(m[1]!, 16)
  const channel = (v: number): number => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  const r = channel((n >> 16) & 0xff)
  const g = channel((n >> 8) & 0xff)
  const b = channel(n & 0xff)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function applyHeroTheme(root: HTMLElement, seed: string): void {
  const { from, to } = heroColors(seed)
  root.style.setProperty('--hero-from', from)
  root.style.setProperty('--hero-to', to)
  const light = relativeLuminance(to) > 0.45 || relativeLuminance(from) > 0.6
  root.style.setProperty('--hero-text', light ? 'rgba(20, 20, 23, 0.92)' : 'rgba(255, 255, 255, 0.95)')
  root.style.setProperty('--hero-text-secondary', light ? 'rgba(20, 20, 23, 0.62)' : 'rgba(255, 255, 255, 0.64)')
}
