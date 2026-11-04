/** Persistent bottom player bar (desktop full bar / mobile compact). */

import type { PlayerSnapshot, PlayerEngine } from '@/engine/player'
import { qs, on, attachArtworkFallback } from '@/ui/el'
import { icon } from '@/ui/icons'
import { createSlider } from '@/ui/slider'
import { songById, artistNamesFor, albumById } from '@/data/catalog-helpers'
import { isFavoriteSong, toggleFavoriteSong } from '@/state/library-store'
import { artSrc, artworkDataUrl } from '@/utils/artwork'
import { formatTime } from '@/utils/format'
import { showToast } from '@/ui/toast'

export interface PlayerBarHandle {
  el: HTMLElement
  update(snap: PlayerSnapshot): void
}

export function createPlayerBar(player: PlayerEngine): PlayerBarHandle {
  const el = document.createElement('footer')
  el.className = 'player-bar'
  el.setAttribute('aria-label', 'Player')
  el.innerHTML = `
    <div class="player-edge-progress"></div>
    <div class="player-left">
      <a class="pl-art-link" href="/now-playing" data-nav aria-label="Open Now Playing">
        <img class="pl-art" alt="" width="40" height="40" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E" />
      </a>
      <div class="pl-meta">
        <a class="pl-title truncate" href="#" data-nav>Nothing Playing</a>
        <div class="pl-artist truncate"></div>
      </div>
    </div>
    <div class="player-center">
      <div class="player-transport" role="group" aria-label="Playback controls">
        <button type="button" class="icon-btn" data-action="cycle-repeat" aria-label="Repeat" aria-pressed="false">${icon('repeat')}</button>
        <button type="button" class="icon-btn" data-action="player-prev" aria-label="Previous track">${icon('prev')}</button>
        <button type="button" class="icon-btn play-btn" data-action="toggle-play" aria-label="Play">${icon('play')}</button>
        <button type="button" class="icon-btn" data-action="player-next" aria-label="Next track">${icon('next')}</button>
        <button type="button" class="icon-btn" data-action="toggle-shuffle" aria-label="Shuffle" aria-pressed="false">${icon('shuffle')}</button>
      </div>
    </div>
    <div class="player-right">
      <button type="button" class="icon-btn desktop-only fav-btn" data-action="fav-current" aria-label="Favorite" aria-pressed="false">${icon('heart')}</button>
      <a href="/now-playing?panel=lyrics" data-nav class="icon-btn desktop-only" aria-label="Lyrics">${icon('lyrics')}</a>
      <a href="/now-playing?panel=queue" data-nav class="icon-btn" aria-label="Playing Next">${icon('queue')}</a>
      <div class="volume desktop-only">
        <button type="button" class="icon-btn" data-action="toggle-mute" aria-label="Mute">${icon('volume')}</button>
        <div class="volume-slot"></div>
      </div>
      <a href="/now-playing" data-nav class="icon-btn" aria-label="Expand player">${icon('chevron-down')}</a>
    </div>`

  // Seek lives on the top edge (reference): a thin, full-width slider line.
  const seekSlider = createSlider({
    value: 0,
    label: 'Seek',
    formatValue: (v) => {
      const { durationMs } = player.getSnapshot()
      return durationMs ? `${formatTime(v * durationMs)} of ${formatTime(durationMs)}` : 'No track'
    },
    onChange: (v, { commit }) => {
      const snap = player.getSnapshot()
      if (!snap.durationMs) return
      if (commit) player.seekTo(v * snap.durationMs)
    },
  })
  qs('.player-edge-progress', el)?.appendChild(seekSlider.el)

  const volumeSlider = createSlider({
    value: 1,
    label: 'Volume',
    accent: true,
    onChange: (v, { commit }) => {
      if (commit) player.setVolume(v)
      else player.setVolume(v)
    },
  })
  qs('.volume-slot', el)?.appendChild(volumeSlider.el)

  const playBtn = qs<HTMLButtonElement>('[data-action="toggle-play"]', el)
  const shuffleBtn = qs<HTMLButtonElement>('[data-action="toggle-shuffle"]', el)
  const repeatBtn = qs<HTMLButtonElement>('[data-action="cycle-repeat"]', el)
  const muteBtn = qs<HTMLButtonElement>('[data-action="toggle-mute"]', el)
  const favBtn = qs<HTMLButtonElement>('[data-action="fav-current"]', el)
  const artImgEl = qs<HTMLImageElement>('.pl-art', el)
  const titleEl = qs<HTMLElement>('.pl-title', el)
  const artistEl = qs<HTMLElement>('.pl-artist', el)
  const artLink = qs<HTMLAnchorElement>('.pl-art-link', el)

  attachArtworkFallback(el)

  let lastSongId: string | null = null
  let lastVol = -1

  function update(snap: PlayerSnapshot): void {
    const song = snap.currentSongId ? songById(snap.currentSongId) : null
    const playing = snap.status === 'playing' || snap.status === 'loading'
    if (playBtn) {
      playBtn.innerHTML = icon(playing ? 'pause' : 'play')
      playBtn.setAttribute('aria-label', playing ? 'Pause' : 'Play')
      playBtn.disabled = !snap.currentSongId
    }
    if (shuffleBtn) shuffleBtn.setAttribute('aria-pressed', String(snap.shuffle))
    if (repeatBtn) {
      repeatBtn.innerHTML = icon(snap.repeat === 'one' ? 'repeat-1' : 'repeat')
      repeatBtn.setAttribute('aria-pressed', String(snap.repeat !== 'off'))
      repeatBtn.setAttribute('aria-label', snap.repeat === 'off' ? 'Repeat off' : snap.repeat === 'all' ? 'Repeat all' : 'Repeat one')
    }
    if (muteBtn) {
      muteBtn.innerHTML = icon(snap.muted || snap.volume === 0 ? 'volume-mute' : 'volume')
      muteBtn.setAttribute('aria-label', snap.muted ? 'Unmute' : 'Mute')
    }
    if (favBtn && song) {
      const fav = isFavoriteSong(song.id)
      favBtn.innerHTML = icon(fav ? 'heart-fill' : 'heart')
      favBtn.setAttribute('aria-pressed', String(fav))
      favBtn.setAttribute('aria-label', fav ? 'Remove from favorites' : 'Add to favorites')
    }
    if (song && song.id !== lastSongId) {
      lastSongId = song.id
      const album = albumById(song.albumId)
      if (artImgEl && album) {
        artImgEl.src = artSrc(album.artworkSeed)
        artImgEl.onerror = () => {
          artImgEl.src = artworkDataUrl(album.artworkSeed)
          artImgEl.onerror = null
        }
        artImgEl.alt = `Cover of ${album.title}`
      }
      if (titleEl) {
        titleEl.textContent = song.title
        titleEl.setAttribute('href', `/album/${song.albumId}`)
      }
      if (artistEl) artistEl.textContent = artistNamesFor(song)
      if (artLink) artLink.setAttribute('href', `/now-playing`)
    } else if (!song && lastSongId !== null) {
      lastSongId = null
      if (titleEl) titleEl.textContent = 'Nothing Playing'
      if (artistEl) artistEl.textContent = ''
    }
    if (snap.volume !== lastVol) {
      lastVol = snap.volume
      volumeSlider.setValue(snap.muted ? 0 : snap.volume)
    }
    const dur = snap.durationMs
    const pos = snap.positionMs
    seekSlider.setValue(dur ? pos / dur : 0)
    seekSlider.setEnabled(Boolean(dur))
    el.classList.toggle('has-track', Boolean(song))
  }

  on(el, 'click', '[data-action="fav-current"]', () => {
    const snap = player.getSnapshot()
    if (!snap.currentSongId) return
    toggleFavoriteSong(snap.currentSongId)
    update(player.getSnapshot())
  })

  player.subscribe(update)
  player.subscribeTick((snap) => {
    // tick-only updates: the edge progress line
    const dur = snap.durationMs
    const pos = snap.positionMs
    seekSlider.setValue(dur ? pos / dur : 0)
  })

  return { el, update }
}

/** Exported for tests / toast hooks */
export function notifyBlocked(): void {
  showToast({ message: 'Press play to start audio (browser autoplay policy).', durationMs: 5000 })
}
