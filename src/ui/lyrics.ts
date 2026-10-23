/** Lyrics panel — uses original embedded demo lyrics when a song has them. */

import type { PlayerEngine, PlayerSnapshot } from '@/engine/player'
import { songById } from '@/data/catalog-helpers'
import { on } from '@/ui/el'
import { emptyStateHtml } from '@/ui/media'

export function renderLyrics(container: HTMLElement, player: PlayerEngine): () => void {
  const draw = (snap: PlayerSnapshot) => {
    const song = snap.currentSongId ? songById(snap.currentSongId) : null
    if (!song || !song.lyrics || song.lyrics.length === 0) {
      container.innerHTML = emptyStateHtml('lyrics', 'No lyrics available', 'Lyrics appear here when a track includes them.')
      return
    }
    const lines = song.lyrics
      .map((line, i) => {
        const next = song.lyrics?.[i + 1]
        const end = next ? next.t : Number.POSITIVE_INFINITY
        const active = snap.positionMs >= line.t && snap.positionMs < end
        return `<li class="lyric-line${active ? ' is-active' : ''}" data-t="${line.t}">${line.text.replaceAll('<', '&lt;')}</li>`
      })
      .join('')
    container.innerHTML = `<ol class="lyrics-lines" aria-label="Lyrics for ${song.title.replaceAll('"', '')}">${lines}</ol>`
    const activeEl = container.querySelector<HTMLElement>('.lyric-line.is-active')
    activeEl?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }

  const unsub = player.subscribe(draw)
  const unsubTick = player.subscribeTick((snap) => {
    // cheap active-line tracking
    const song = snap.currentSongId ? songById(snap.currentSongId) : null
    if (!song?.lyrics) return
    let activeIdx = -1
    for (let i = 0; i < song.lyrics.length; i++) {
      const line = song.lyrics[i]!
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
    player.seekTo(t)
    player.play()
  })
  return () => {
    unsub()
    unsubTick()
  }
}
