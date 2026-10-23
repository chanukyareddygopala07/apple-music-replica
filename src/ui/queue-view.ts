/** Up-next queue list (used in Now Playing side panel). */

import type { PlayerEngine, PlayerSnapshot } from '@/engine/player'
import type { Song, QueueItem } from '@/domain/types'
import { songById, artistNamesFor } from '@/data/catalog-helpers'
import { attachArtworkFallback, on, qs, artImg } from '@/ui/el'
import { icon } from '@/ui/icons'
import { emptyStateHtml } from '@/ui/media'

export function renderQueue(container: HTMLElement, player: PlayerEngine): () => void {
  const draw = (snap: PlayerSnapshot) => {
    const songs: Array<{ item: QueueItem; i: number; song: Song }> = []
    for (let i = 0; i < snap.queue.length; i++) {
      const item = snap.queue[i]!
      const song = songById(item.songId)
      if (song) songs.push({ item, i, song })
    }

    if (songs.length === 0) {
      container.innerHTML = emptyStateHtml('queue', 'Nothing queued', 'Play an album or playlist to fill your queue.')
      return
    }

    const rows = songs
      .map(({ item, i, song }) => {
        const current = i === snap.index
        return `
        <li class="queue-row${current ? ' is-current' : ''}" data-queue-item-id="${item.queueItemId}" data-index="${i}" draggable="${!current}">
          <button type="button" class="icon-btn drag-handle" aria-label="Reorder ${escapeAttr(song.title)}. Use move buttons in the menu." tabindex="-1">${icon('drag')}</button>
          ${artImg(`album-${song.albumId}`, song.title)}
          <div class="row-main">
            <div class="q-title truncate">${escapeHtml(song.title)}</div>
            <div class="q-sub truncate">${escapeHtml(artistNamesFor(song))}</div>
          </div>
          <button type="button" class="icon-btn" data-action="queue-move-up" data-queue-item-id="${item.queueItemId}" aria-label="Move ${escapeAttr(song.title)} up" ${i === 0 || current ? 'disabled' : ''}>${icon('chevron-left')}</button>
          <button type="button" class="icon-btn" data-action="queue-remove" data-queue-item-id="${item.queueItemId}" aria-label="Remove ${escapeAttr(song.title)} from queue" ${current ? 'disabled' : ''}>${icon('close')}</button>
        </li>`
      })
      .join('')

    container.innerHTML = `
      <div class="queue-now-label">Playing Next</div>
      <ol class="queue-list" aria-label="Queue">${rows}</ol>
      <div style="padding:16px 4px;display:flex;gap:12px">
        <button type="button" class="btn btn-secondary" data-action="queue-clear">Clear</button>
      </div>`
    attachArtworkFallback(container)
    wireDrag(container, player)
  }

  const unsub = player.subscribe(draw)
  on(container, 'click', '[data-action="queue-remove"]', (el) => {
    const id = el.getAttribute('data-queue-item-id')
    if (id) player.removeQueueItem(id)
  })
  on(container, 'click', '[data-action="queue-move-up"]', (el) => {
    const id = el.getAttribute('data-queue-item-id')
    if (!id) return
    const snap = player.getSnapshot()
    const idx = snap.queue.findIndex((q) => q.queueItemId === id)
    if (idx > 0) player.moveQueueItem(idx, idx - 1)
  })
  on(container, 'click', '[data-action="queue-clear"]', () => {
    player.clearUpcoming()
  })
  on(container, 'click', '.queue-row', (el, ev) => {
    if ((ev.target as Element).closest('button')) return
    const idx = Number(el.getAttribute('data-index') ?? '-1')
    if (idx >= 0) player.jumpToIndex(idx, true)
  })
  return unsub
}

function wireDrag(container: HTMLElement, player: PlayerEngine): void {
  let dragId: string | null = null
  on(container, 'dragstart', '.queue-row', (el) => {
    dragId = el.getAttribute('data-queue-item-id')
    el.classList.add('dragging')
  })
  on(container, 'dragend', '.queue-row', (el) => {
    el.classList.remove('dragging')
    dragId = null
  })
  on(container, 'dragover', '.queue-row', (_el, ev) => {
    ev.preventDefault()
  })
  on(container, 'drop', '.queue-row', (el, ev) => {
    ev.preventDefault()
    if (!dragId) return
    const toId = el.getAttribute('data-queue-item-id')
    if (!toId || toId === dragId) return
    const snap = player.getSnapshot()
    const from = snap.queue.findIndex((q) => q.queueItemId === dragId)
    const to = snap.queue.findIndex((q) => q.queueItemId === toId)
    if (from >= 0 && to >= 0) player.moveQueueItem(from, to)
    dragId = null
  })
}

function escapeHtml(s: string): string {
  return s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
}
function escapeAttr(s: string): string {
  return escapeHtml(s).replaceAll("'", '&#39;')
}

/** Helper kept for now-playing to know queue length */
export function queueCountLabel(player: PlayerEngine): string {
  const n = player.getSnapshot().queue.length
  return n === 0 ? 'Queue is empty' : `${n} in queue`
}

export function currentQueueRow(container: HTMLElement): HTMLElement | null {
  return qs('.queue-row.is-current', container)
}
