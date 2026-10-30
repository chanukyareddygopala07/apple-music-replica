/**
 * Lyrics panel — embedded demo originals first, then remote LRCLIB lyrics
 * (through the Realaxify API) for songs without them.
 *
 * Attribution: whenever LRCLIB lyrics are shown the panel links back to
 * lrclib.net. Remote lookups happen at most once per song id per session
 * (misses are remembered too), and a failed lookup renders the honest empty
 * state — the panel never blocks or warns during playback.
 */

import type { PlayerEngine, PlayerSnapshot } from '@/engine/player'
import type { LyricLine } from '@/domain/types'
import { songById } from '@/data/catalog-helpers'
import { resolveLyrics } from '@/data/lyrics-source'
import { on } from '@/ui/el'
import { emptyStateHtml } from '@/ui/media'

interface PanelLyrics {
  lines: LyricLine[]
  attributionName?: string
  attributionUrl?: string
  instrumental: boolean
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;')
}

export function renderLyrics(container: HTMLElement, player: PlayerEngine): () => void {
  /** Last resolved lyrics per song id (embedded or remote), in-session only. */
  const resolved = new Map<string, PanelLyrics | 'pending' | 'none'>()
  let lastSongId: string | null = null

  const draw = (snap: PlayerSnapshot) => {
    const song = snap.currentSongId ? songById(snap.currentSongId) : null
    if (!song) {
      container.innerHTML = emptyStateHtml('lyrics', 'No lyrics available', 'Lyrics appear here when a track includes them.')
      lastSongId = null
      return
    }
    const state = resolved.get(song.id)
    if (state === undefined) {
      // Embedded originals (the demo catalogue) render immediately — only
      // songs without them trigger a remote lookup.
      if (song.lyrics?.length) {
        resolved.set(song.id, { lines: song.lyrics, instrumental: false })
        return draw(snap)
      }
      resolved.set(song.id, 'pending')
      container.innerHTML = emptyStateHtml('lyrics', 'Looking up lyrics…', 'Checking LRCLIB for this track.')
      void loadRemote(song.id)
      lastSongId = song.id
      return
    }
    if (state === 'pending') {
      if (lastSongId !== song.id) {
        container.innerHTML = emptyStateHtml('lyrics', 'Looking up lyrics…', 'Checking LRCLIB for this track.')
        lastSongId = song.id
      }
      return
    }
    if (state === 'none') {
      container.innerHTML = emptyStateHtml('lyrics', 'No lyrics available', 'Lyrics appear here when a track includes them.')
      lastSongId = song.id
      return
    }
    if (!state.lines.length) {
      container.innerHTML =
        emptyStateHtml('lyrics', 'Instrumental', 'This track has no lyrics.') + attributionHtml(state)
      lastSongId = song.id
      return
    }
    const lines = state.lines
      .map((line, i) => {
        const next = state.lines[i + 1]
        const end = next ? next.t : Number.POSITIVE_INFINITY
        const active = snap.positionMs >= line.t && snap.positionMs < end
        return `<li class="lyric-line${active ? ' is-active' : ''}" data-t="${line.t}">${escapeHtml(line.text)}</li>`
      })
      .join('')
    container.innerHTML = `<ol class="lyrics-lines" aria-label="Lyrics for ${escapeHtml(song.title)}">${lines}</ol>${attributionHtml(state)}`
    lastSongId = song.id
    const activeEl = container.querySelector<HTMLElement>('.lyric-line.is-active')
    activeEl?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }

  async function loadRemote(songId: string): Promise<void> {
    const song = songById(songId)
    if (!song) return
    try {
      const lyrics = await resolveLyrics(song)
      resolved.set(songId, lyrics ?? 'none')
    } catch {
      // Transport failure: show the empty state but do not cache the miss.
      resolved.delete(songId)
      return
    }
    // Re-render if this song is still the one on screen.
    if (player.getSnapshot().currentSongId === songId) draw(player.getSnapshot())
  }

  const unsub = player.subscribe(draw)
  const unsubTick = player.subscribeTick((snap) => {
    // cheap active-line tracking
    const song = snap.currentSongId ? songById(snap.currentSongId) : null
    const state = song ? resolved.get(song.id) : undefined
    if (!state || state === 'pending' || state === 'none' || !state.lines.length) return
    let activeIdx = -1
    for (let i = 0; i < state.lines.length; i++) {
      const line = state.lines[i]!
      if (snap.positionMs >= line.t) activeIdx = i
    }
    container.querySelectorAll('.lyric-line').forEach((el, i) => {
      el.classList.toggle('is-active', i === activeIdx)
    })
    const activeEl = container.querySelector<HTMLElement>('.lyric-line.is-active')
    if (activeEl) {
      const rect = activeEl.getBoundingClientRect()
      const parent = container.getBoundingClientRect()
      if (rect.top < parent.top || rect.bottom > parent.bottom) {
        activeEl.scrollIntoView({ block: 'center', behavior: 'smooth' })
      }
    }
  })
  on(container, 'click', '.lyric-line', (el) => {
    const t = Number(el.getAttribute('data-t') ?? '0')
    if (!Number.isFinite(t)) return // unsynced plain lines are not seekable
    player.seekTo(t)
    player.play()
  })
  return () => {
    unsub()
    unsubTick()
  }
}

function attributionHtml(state: PanelLyrics): string {
  if (!state.attributionUrl || state.instrumental) return ''
  const name = escapeHtml(state.attributionName ?? 'LRCLIB')
  return `<p class="lyrics-attribution" style="margin:12px 0 0;font-size:11px;color:var(--color-text-secondary)">Lyrics: <a href="${escapeHtml(state.attributionUrl)}" target="_blank" rel="noopener noreferrer">${name}</a></p>`
}
