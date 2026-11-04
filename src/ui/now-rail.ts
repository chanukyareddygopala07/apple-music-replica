/** Right rail: the reference's "Now playing" queue column.
    Rows are `.song-row` elements inside `[data-song-list]`, so the shared
    click/keyboard handlers play them through the regular queue path.
    Motion is driven by real playback state: the equalizer overlay only runs
    while `status === 'playing'`, and the active row counts down on tick. */

import type { PlayerSnapshot, PlayerEngine } from '@/engine/player'
import { artImg, attachArtworkFallback, escapeHtml, qs } from '@/ui/el'
import { artistNamesFor, songById } from '@/data/catalog-helpers'
import { formatTime } from '@/utils/format'

export interface NowRailHandle {
  el: HTMLElement
  update(snap: PlayerSnapshot): void
}

const EQ_BARS = '<span class="eq-bars" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span>'

export function createNowRail(player: PlayerEngine): NowRailHandle {
  const el = document.createElement('aside')
  el.className = 'side-rail'
  el.setAttribute('aria-label', 'Now playing')
  el.innerHTML = `
    <div class="rail-header">
      <h2 class="rail-title">Now playing</h2>
      <a class="rail-view-all" href="/now-playing?panel=queue" data-nav>View all</a>
    </div>
    <div class="rail-scroll">
      <div class="rail-rows" data-song-list role="list"></div>
      <p class="rail-empty" hidden>Nothing playing yet. Start a song and the queue appears here.</p>
    </div>`

  const rowsEl = qs<HTMLElement>('.rail-rows', el)!
  const emptyEl = qs<HTMLElement>('.rail-empty', el)!
  let renderedKey = ''
  let activeRow: HTMLElement | null = null

  function rowHtml(songId: string, current: boolean, remainingMs: number): string {
    const song = songById(songId)
    if (!song) return ''
    const seed = song.artworkUrl ?? `album-${song.albumId}`
    const timeText = current
      ? song.durationMs > 0
        ? formatTime(Math.max(0, remainingMs))
        : '--:--'
      : formatTime(song.durationMs)
    return `
      <div class="song-row${current ? ' is-current' : ''}" role="row" tabindex="0"
        data-song-id="${escapeHtml(song.id)}" data-context="rail"${current ? ' aria-current="true"' : ''}>
        <span class="row-art-wrap">${artImg(seed, song.title, 'row-art')}${current ? EQ_BARS : ''}</span>
        <div class="row-main">
          <div class="row-title"><span class="row-title-text">${escapeHtml(song.title)}</span></div>
          <div class="row-sub">${escapeHtml(artistNamesFor(song))}</div>
        </div>
        <span class="row-duration mono-num">${timeText}</span>
      </div>`
  }

  function render(snap: PlayerSnapshot): void {
    const hasQueue = snap.queue.length > 0 && snap.currentSongId !== null
    rowsEl.hidden = !hasQueue
    emptyEl.hidden = hasQueue
    if (!hasQueue) {
      rowsEl.innerHTML = ''
      renderedKey = ''
      activeRow = null
      return
    }
    const remaining = snap.durationMs > 0 ? snap.durationMs - snap.positionMs : 0
    rowsEl.innerHTML = snap.queue
      .map((item, i) => rowHtml(item.songId, i === snap.index, remaining))
      .join('')
    attachArtworkFallback(rowsEl)
    activeRow = rowsEl.querySelector<HTMLElement>('.song-row.is-current')
  }

  function update(snap: PlayerSnapshot): void {
    el.setAttribute('data-playing', String(snap.status === 'playing'))
    const key = `${snap.queue.map((q) => q.songId).join('|')}#${snap.index}#${snap.currentSongId ?? ''}`
    if (key !== renderedKey) {
      renderedKey = key
      render(snap)
    }
    tick(snap)
  }

  /** Cheap per-tick refresh: only the active row's countdown text changes. */
  function tick(snap: PlayerSnapshot): void {
    if (!activeRow || !snap.currentSongId) return
    const dur = snap.durationMs
    if (!dur) return
    const timeEl = activeRow.querySelector<HTMLElement>('.row-duration')
    if (timeEl) timeEl.textContent = formatTime(Math.max(0, dur - snap.positionMs))
  }

  update(player.getSnapshot())

  return { el, update }
}
