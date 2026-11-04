/** Shared media UI: song rows, cards, carousels, skeletons, empty states. */

import type { Album, Playlist, Song } from '@/domain/types'
import { artistNamesFor, getCatalog } from '@/data/catalog-helpers'
import { languageLabel, normalizeTrackLanguage } from '@/data/languages'
import { sourceName } from '@/data/sources'
import { escapeHtml, artImg } from '@/ui/el'
import { icon, type IconName } from '@/ui/icons'
import { formatTime } from '@/utils/format'
import { fitForWhiteText, heroColors } from '@/utils/artwork'

/** Source pill for provider-sourced rows — demo rows carry no `source`. */
function sourceBadgeHtml(song: Song): string {
  if (!song.source || song.source === 'demo') return ''
  const name = sourceName(song.source)
  return `<span class="source-badge" title="Source: ${escapeHtml(name)}">${escapeHtml(name)}</span>`
}

/**
 * Compact language pill — rendered only when the track declares a language
 * this catalogue can label; unknown languages stay unlabelled (never guessed).
 */
export function languageBadgeHtml(song: Song): string {
  const code = normalizeTrackLanguage(song.language)
  if (!code) return ''
  const label = languageLabel(code)
  return `<span class="language-badge" title="Language: ${escapeHtml(label)}">${escapeHtml(label)}</span>`
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
        <div class="row-title"><span class="row-title-text">${escapeHtml(song.title)}</span>${song.explicit ? '<span class="explicit-badge" title="Explicit" aria-label="Explicit">E</span>' : ''}${sourceBadgeHtml(song)}${languageBadgeHtml(song)}</div>
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
  const count = pl.songIds.length
  return `
    <a class="media-card pl-card" href="${escapeHtml(`/playlist/${pl.id}`)}" data-nav
      style="--pl-base:${fitForWhiteText(heroColors(pl.artworkSeed).from)}"
      aria-label="${escapeHtml(pl.title)}">
      <div class="pl-card-title">${escapeHtml(pl.title)}</div>
      <div class="pl-card-art">${artImg(pl.artworkSeed, pl.title)}</div>
      <div class="pl-card-meta">${count} track${count === 1 ? '' : 's'}</div>
      <button type="button" class="card-play" data-action="play-context" data-kind="playlist" data-id="${escapeHtml(pl.id)}" aria-label="Play ${escapeHtml(pl.title)}">${icon('play')}</button>
    </a>`
}

/**
 * YouTube video card for the Home YouTube Music section: thumbnail, title,
 * channel, provider/language badges and duration. The whole card is the
 * watch action (`/watch/yt-…` → visible official embed) — never an audio
 * play button: YouTube never enters the <audio> queue.
 */
export function youtubeCardHtml(song: Song): string {
  const sub = artistNamesFor(song)
  const duration = song.durationMs > 0 ? formatTime(song.durationMs) : ''
  return `
    <a class="media-card yt-card" href="${escapeHtml(`/watch/${song.id}`)}" data-nav
      aria-label="Watch ${escapeHtml(song.title)}">
      <div class="art-wrap">
        ${artImg(songArtSeed(song), song.title)}
        ${duration ? `<span class="yt-duration mono-num" aria-hidden="true">${duration}</span>` : ''}
        <span class="card-play" aria-hidden="true">${icon('play')}</span>
      </div>
      <div class="card-title clamp-2">${escapeHtml(song.title)}${sourceBadgeHtml(song)}${languageBadgeHtml(song)}</div>
      <div class="card-sub clamp-2">${escapeHtml(sub)}</div>
    </a>`
}

export function sectionHeaderHtml(title: string, href?: string): string {
  // Linked headers read like the reference ("Title … View all"); the whole
  // anchor stays the link, so the accessible name carries both parts.
  return href
    ? `<div class="section-header"><a class="section-title" href="${escapeHtml(href)}" data-nav><span>${escapeHtml(title)}</span><span class="st-view">View all</span></a></div>`
    : `<div class="section-header"><h2 class="section-title">${escapeHtml(title)}</h2></div>`
}

/** Horizontal scroller with arrow buttons; `trackAttrs` decorates the track (e.g. `data-song-list`). */
export function carouselWrapHtml(trackInner: string, trackAttrs = ''): string {
  return `
    <div class="carousel">
      <button type="button" class="carousel-arrow" data-side="prev" aria-label="Scroll back">${icon('chevron-left')}</button>
      <div class="carousel-track" ${trackAttrs}>${trackInner}</div>
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

export function applyHeroTheme(root: HTMLElement, seed: string): void {
  const { from, to } = heroColors(seed)
  // White ink only: every hero stop is fitted to the white-text luminance band
  // (see fitForWhiteText), so primary (0.95) and secondary (0.9) text clear
  // AA 4.5:1 anywhere the gradient — or its fade into --color-bg — appears.
  root.style.setProperty('--hero-from', fitForWhiteText(from))
  root.style.setProperty('--hero-to', fitForWhiteText(to))
  root.style.setProperty('--hero-text', 'rgba(255, 255, 255, 0.95)')
  root.style.setProperty('--hero-text-secondary', 'rgba(255, 255, 255, 0.9)')
}
