/** Now Playing overlay — large artwork, transport, lyrics + queue panels. */

import type { PlayerEngine, PlayerSnapshot } from '@/engine/player'
import { albumById, artistNamesFor, songById } from '@/data/catalog-helpers'
import { attachArtworkFallback, on, qs } from '@/ui/el'
import { icon } from '@/ui/icons'
import { createSlider } from '@/ui/slider'
import { formatTime } from '@/utils/format'
import { artSrc, artworkDataUrl } from '@/utils/artwork'
import { renderLyrics } from '@/ui/lyrics'
import { renderQueue } from '@/ui/queue-view'
import { applyHeroTheme } from '@/ui/media'
import { isFavoriteSong, toggleFavoriteSong } from '@/state/library-store'
import { showToast } from '@/ui/toast'

export interface NowPlayingHandle {
  el: HTMLElement
  open(panel: 'lyrics' | 'queue'): void
  close(): void
  destroy(): void
}

export function createNowPlaying(player: PlayerEngine, onClose: () => void): NowPlayingHandle {
  const el = document.createElement('section')
  el.className = 'now-playing'
  el.setAttribute('aria-label', 'Now Playing')
  el.hidden = true
  el.innerHTML = `
    <div class="np-main">
      <button type="button" class="icon-btn lg np-close" data-np-close aria-label="Close Now Playing">${icon('chevron-down')}</button>
      <img class="np-art" alt="" src="" />
      <div class="np-meta">
        <div style="min-width:0">
          <a class="np-title truncate" href="#" data-np-title>Nothing Playing</a>
          <div><a class="np-artist truncate" href="#" data-np-artist></a></div>
        </div>
        <button type="button" class="icon-btn lg" data-action="fav-current-np" aria-label="Favorite">${icon('heart')}</button>
      </div>
      <div class="np-controls">
        <div class="np-times"><span class="np-elapsed mono-num">0:00</span><span class="np-total mono-num">0:00</span></div>
        <div class="np-progress-slot"></div>
        <div class="np-buttons">
          <button type="button" class="icon-btn lg" data-action="toggle-shuffle" aria-label="Shuffle" aria-pressed="false">${icon('shuffle')}</button>
          <div class="transport">
            <button type="button" class="icon-btn lg" data-action="player-prev" aria-label="Previous">${icon('prev')}</button>
            <button type="button" class="icon-btn np-play" data-action="toggle-play" aria-label="Play">${icon('play')}</button>
            <button type="button" class="icon-btn lg" data-action="player-next" aria-label="Next">${icon('next')}</button>
          </div>
          <button type="button" class="icon-btn lg" data-action="cycle-repeat" aria-label="Repeat" aria-pressed="false">${icon('repeat')}</button>
        </div>
      </div>
    </div>
    <aside class="np-side" aria-label="Lyrics and queue">
      <div class="np-tabs" role="tablist">
        <button type="button" class="chip" role="tab" data-np-tab="lyrics" aria-selected="true">Lyrics</button>
        <button type="button" class="chip" role="tab" data-np-tab="queue" aria-selected="false">Queue</button>
      </div>
      <div class="np-panel" data-np-panel></div>
    </aside>`

  const progress = createSlider({
    value: 0,
    label: 'Seek',
    onChange: (v, { commit }) => {
      const snap = player.getSnapshot()
      if (!snap.durationMs) return
      if (commit) player.seekTo(v * snap.durationMs)
    },
  })
  qs('.np-progress-slot', el)?.appendChild(progress.el)

  let panel: 'lyrics' | 'queue' = 'lyrics'
  let panelCleanup: (() => void) | null = null
  const panelEl = qs<HTMLElement>('[data-np-panel]', el)!

  function drawPanel(): void {
    panelCleanup?.()
    panelCleanup = null
    el.setAttribute('data-panel', panel)
    el.querySelectorAll<HTMLButtonElement>('[data-np-tab]').forEach((btn) => {
      btn.setAttribute('aria-selected', String(btn.getAttribute('data-np-tab') === panel))
    })
    panelEl.innerHTML = ''
    panelCleanup = panel === 'queue' ? renderQueue(panelEl, player) : renderLyrics(panelEl, player)
  }

  function applyTheme(snap: PlayerSnapshot): void {
    const song = snap.currentSongId ? songById(snap.currentSongId) : null
    const album = song ? albumById(song.albumId) : null
    const seed = album?.artworkSeed ?? song?.id ?? 'sonora'
    applyHeroTheme(el, seed)
  }

  function update(snap: PlayerSnapshot): void {
    const song = snap.currentSongId ? songById(snap.currentSongId) : null
    applyTheme(snap)
    const art = qs<HTMLImageElement>('.np-art', el)
    const title = qs<HTMLElement>('[data-np-title]', el)
    const artist = qs<HTMLElement>('[data-np-artist]', el)
    const playBtn = qs<HTMLButtonElement>('[data-action="toggle-play"]', el)
    const favBtn = qs<HTMLButtonElement>('[data-action="fav-current-np"]', el)
    const shuffleBtn = qs<HTMLButtonElement>('[data-action="toggle-shuffle"]', el)
    const repeatBtn = qs<HTMLButtonElement>('[data-action="cycle-repeat"]', el)
    if (song) {
      const album = albumById(song.albumId)
      if (art && album) {
        art.src = artSrc(album.artworkSeed)
        art.onerror = () => {
          art.src = artworkDataUrl(album.artworkSeed)
          art.onerror = null
        }
        art.alt = `Cover of ${album.title}`
      }
      if (title) {
        title.textContent = song.title
        title.setAttribute('href', `/album/${song.albumId}`)
      }
      if (artist) {
        artist.textContent = artistNamesFor(song)
        artist.setAttribute('href', song.artistIds[0] ? `/artist/${song.artistIds[0]}` : '#')
      }
      if (favBtn) {
        const fav = isFavoriteSong(song.id)
        favBtn.innerHTML = icon(fav ? 'heart-fill' : 'heart')
        favBtn.setAttribute('aria-pressed', String(fav))
        favBtn.style.color = fav ? 'var(--color-accent)' : ''
      }
    }
    const playing = snap.status === 'playing' || snap.status === 'loading'
    if (playBtn) {
      playBtn.innerHTML = icon(playing ? 'pause' : 'play')
      playBtn.setAttribute('aria-label', playing ? 'Pause' : 'Play')
    }
    if (shuffleBtn) shuffleBtn.setAttribute('aria-pressed', String(snap.shuffle))
    if (repeatBtn) {
      repeatBtn.innerHTML = icon(snap.repeat === 'one' ? 'repeat-1' : 'repeat')
      repeatBtn.setAttribute('aria-pressed', String(snap.repeat !== 'off'))
    }
    qs<HTMLElement>('.np-elapsed', el)!.textContent = formatTime(snap.positionMs)
    qs<HTMLElement>('.np-total', el)!.textContent = snap.durationMs ? formatTime(snap.durationMs) : '--:--'
    progress.setValue(snap.durationMs ? snap.positionMs / snap.durationMs : 0)
  }

  on(el, 'click', '[data-np-close]', () => onClose())
  on(el, 'click', '[data-np-tab]', (btn) => {
    const p = btn.getAttribute('data-np-tab')
    if (p === 'queue' || p === 'lyrics') drawPanel()
  })
  on(el, 'click', '[data-action="fav-current-np"]', () => {
    const snap = player.getSnapshot()
    if (!snap.currentSongId) return
    toggleFavoriteSong(snap.currentSongId)
    update(player.getSnapshot())
    showToast({ message: isFavoriteSong(snap.currentSongId) ? 'Added to favorites' : 'Removed from favorites' })
  })
  const unsub = player.subscribe(update)
  const unsubTick = player.subscribeTick((snap) => {
    qs<HTMLElement>('.np-elapsed', el)!.textContent = formatTime(snap.positionMs)
    qs<HTMLElement>('.np-total', el)!.textContent = snap.durationMs ? formatTime(snap.durationMs) : '--:--'
    progress.setValue(snap.durationMs ? snap.positionMs / snap.durationMs : 0)
  })
  attachArtworkFallback(el)
  drawPanel()
  update(player.getSnapshot())

  return {
    el,
    open(p) {
      panel = p
      drawPanel()
      el.hidden = false
      qs<HTMLElement>('.np-close', el)?.focus()
    },
    close() {
      el.hidden = true
    },
    destroy() {
      unsub()
      unsubTick()
      panelCleanup?.()
    },
  }
}
