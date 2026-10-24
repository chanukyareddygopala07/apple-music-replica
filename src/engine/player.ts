/**
 * Shared playback engine.
 *
 * - One HTMLAudioElement for the app's lifetime (never recreated on navigation).
 * - Queue with shuffle / repeat / editable upcoming list.
 * - State published as immutable snapshots on two channels: coarse (track,
 *   status, queue) and tick (position / duration) so list views stay cheap.
 * - Persistence is handled by callers via subscribe (see shell.ts).
 */

import type { PlaybackStatus, QueueItem, RepeatMode, Song } from '@/domain/types'
import { youtubeVideoId } from '@/data/youtube-normalize'

export interface PlayerSnapshot {
  status: PlaybackStatus
  currentSongId: string | null
  queue: QueueItem[]
  index: number
  positionMs: number
  durationMs: number
  volume: number
  muted: boolean
  shuffle: boolean
  repeat: RepeatMode
  error: string | null
  blocked: boolean
  contextLabel: string | null
}

export interface PlayQueueOptions {
  contextLabel?: string | null
  startAt?: number
}

type Listener = (snap: PlayerSnapshot) => void

let counter = 0
function queueItemId(): string {
  counter += 1
  return `q${Date.now().toString(36)}-${counter}`
}

const INITIAL: PlayerSnapshot = {
  status: 'idle',
  currentSongId: null,
  queue: [],
  index: -1,
  positionMs: 0,
  durationMs: 0,
  volume: 1,
  muted: false,
  shuffle: false,
  repeat: 'off',
  error: null,
  blocked: false,
  contextLabel: null,
}

export class PlayerEngine {
  private audio: HTMLAudioElement | null
  private snapshot: PlayerSnapshot = INITIAL
  private listeners = new Set<Listener>()
  private tickListeners = new Set<Listener>()
  /** Unshuffled play order; used to restore order when shuffle is turned off. */
  private baseQueue: QueueItem[] | null = null
  private songs = new Map<string, Song>()
  /** True while a track change is driven by restore() (no autoplay). */
  private restoring = false

  constructor() {
    if (typeof document === 'undefined') {
      this.audio = null
      return
    }
    const audio = new Audio()
    audio.preload = 'auto'
    this.audio = audio
    audio.addEventListener('loadedmetadata', () => {
      this.patch({ durationMs: Math.round((audio.duration || 0) * 1000) })
    })
    audio.addEventListener('timeupdate', () => {
      this.patch({ positionMs: Math.round(audio.currentTime * 1000) }, true)
    })
    audio.addEventListener('play', () => {
      if (!this.restoring) this.patch({ status: 'playing', blocked: false, error: null })
    })
    audio.addEventListener('pause', () => {
      if (!this.restoring && this.snapshot.status !== 'ended' && this.snapshot.status !== 'error') {
        this.patch({ status: 'paused' })
      }
    })
    audio.addEventListener('waiting', () => {
      if (!this.restoring) this.patch({ status: 'loading' })
    })
    audio.addEventListener('canplay', () => {
      if (!this.restoring && this.snapshot.status === 'loading' && !audio.paused) {
        this.patch({ status: 'playing' })
      }
    })
    audio.addEventListener('ended', () => this.handleEnded())
    audio.addEventListener('error', () => this.handleError())
    audio.addEventListener('volumechange', () => {
      this.patch({ volume: audio.volume, muted: audio.muted })
    })
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    listener(this.snapshot)
    return () => this.listeners.delete(listener)
  }

  subscribeTick(listener: Listener): () => void {
    this.tickListeners.add(listener)
    return () => this.tickListeners.delete(listener)
  }

  getSnapshot(): PlayerSnapshot {
    return this.snapshot
  }

  getCurrentSong(): Song | null {
    const id = this.snapshot.currentSongId
    return id ? (this.songs.get(id) ?? null) : null
  }

  private patch(partial: Partial<PlayerSnapshot>, tickOnly = false): void {
    const prev = this.snapshot
    const next = { ...prev, ...partial }
    this.snapshot = next
    const coarseChanged =
      tickOnly ||
      prev.status !== next.status ||
      prev.currentSongId !== next.currentSongId ||
      prev.queue !== next.queue ||
      prev.index !== next.index ||
      prev.volume !== next.volume ||
      prev.muted !== next.muted ||
      prev.shuffle !== next.shuffle ||
      prev.repeat !== next.repeat ||
      prev.error !== next.error ||
      prev.blocked !== next.blocked ||
      prev.contextLabel !== next.contextLabel
    if (!tickOnly) this.listeners.forEach((l) => l(next))
    if (tickOnly || prev.positionMs !== next.positionMs || prev.durationMs !== next.durationMs) {
      this.tickListeners.forEach((l) => l(next))
    }
    if (coarseChanged && !tickOnly) {
      /* listeners already notified */
    }
  }

  private rememberSongs(songs: Song[]): void {
    for (const s of songs) this.songs.set(s.id, s)
  }

  private currentItem(): QueueItem | null {
    return this.snapshot.queue[this.snapshot.index] ?? null
  }

  private loadCurrent(autoplay: boolean, seekMs?: number): void {
    const item = this.currentItem()
    const audio = this.audio
    if (!item || !audio) return
    const song = this.songs.get(item.songId)
    if (!song) {
      this.patch({ status: 'error', error: 'Track not found.' })
      return
    }
    this.patch({ status: 'loading', error: null, currentSongId: song.id, positionMs: seekMs ?? 0 })
    audio.src = song.audioUrl
    audio.load()
    if (seekMs && seekMs > 0) {
      const onMeta = () => {
        try {
          audio.currentTime = seekMs / 1000
        } catch {
          /* seeking may fail before metadata */
        }
        audio.removeEventListener('loadedmetadata', onMeta)
      }
      audio.addEventListener('loadedmetadata', onMeta)
    }
    if (autoplay) {
      void this.safePlay()
    } else {
      this.restoring = false
      this.patch({ status: 'paused' })
    }
  }

  private async safePlay(): Promise<void> {
    const audio = this.audio
    if (!audio) return
    try {
      this.restoring = false
      await audio.play()
      this.patch({ status: 'playing', blocked: false, error: null })
    } catch (err) {
      const name = err instanceof DOMException ? err.name : 'PlayError'
      if (name === 'NotAllowedError') {
        this.patch({ status: 'paused', blocked: true })
      } else if (name !== 'AbortError') {
        this.patch({ status: 'error', error: 'Playback could not start.' })
      }
    }
  }

  private handleError(): void {
    const audio = this.audio
    const code = audio?.error?.code
    const message =
      code === MediaError.MEDIA_ERR_NETWORK
        ? 'Network error while loading audio.'
        : code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED
          ? 'This track is unavailable right now.'
          : 'Playback error.'
    this.patch({ status: 'error', error: message })
  }

  private handleEnded(): void {
    const { repeat, index, queue } = this.snapshot
    if (repeat === 'one') {
      this.restart()
      return
    }
    const isLast = index >= queue.length - 1
    if (isLast) {
      if (repeat === 'all') {
        this.jumpToIndex(0, true)
      } else {
        this.patch({ status: 'ended', positionMs: this.snapshot.durationMs })
      }
      return
    }
    this.next(true)
  }

  /** Start (or restart) a queue of songs. Always replaces the current queue. */
  playQueue(songs: Song[], startIndex = 0, opts: PlayQueueOptions = {}): void {
    // Defence in depth: YouTube videos must never become <audio> queue items
    // (they play only on /watch via the official embed). Callers route them
    // there already; this keeps the invariant even if a new caller forgets.
    const startId = songs[startIndex]?.id
    const playable = songs.filter((s) => s.playbackKind !== 'youtube')
    if (playable.length === 0) return
    songs = playable
    startIndex = startId ? Math.max(0, playable.findIndex((s) => s.id === startId)) : 0
    this.rememberSongs(songs)
    const items: QueueItem[] = songs.map((s) => ({ queueItemId: queueItemId(), songId: s.id }))
    let start = Math.min(Math.max(0, startIndex), items.length - 1)
    let queue = items
    let base: QueueItem[] | null = null
    if (this.snapshot.shuffle && items.length > 1) {
      base = items
      const startItem = items[start]!
      const rest = items.filter((_, i) => i !== start)
      queue = [startItem, ...shuffleArray(rest)]
      start = 0
    }
    this.baseQueue = base
    this.restoring = false
    this.snapshot = { ...this.snapshot, contextLabel: opts.contextLabel ?? null }
    this.patch({ queue, index: start, shuffle: this.snapshot.shuffle, error: null })
    this.loadCurrent(true, opts.startAt)
  }

  /** Restore a previous session without autoplay. */
  restore(songs: Song[], index: number, positionMs: number, contextLabel: string | null): void {
    if (songs.length === 0) return
    this.rememberSongs(songs)
    const items = songs.map((s) => ({ queueItemId: queueItemId(), songId: s.id }))
    const start = Math.min(Math.max(0, index), items.length - 1)
    this.restoring = true
    this.baseQueue = null
    const song = songs[start]!
    this.patch({ queue: items, index: start, contextLabel, status: 'loading', positionMs, currentSongId: song.id })
    const audio = this.audio
    if (!audio) return
    audio.src = song.audioUrl
    const onMeta = () => {
      try {
        audio.currentTime = positionMs / 1000
      } catch {
        /* ignore */
      }
      audio.removeEventListener('loadedmetadata', onMeta)
      this.restoring = false
      this.patch({ status: 'paused', currentSongId: song.id, durationMs: Math.round((audio.duration || 0) * 1000) })
    }
    audio.addEventListener('loadedmetadata', onMeta)
    audio.load()
  }

  togglePlay(): void {
    const { status, currentSongId } = this.snapshot
    if (!currentSongId) return
    if (status === 'playing' || status === 'loading') {
      this.audio?.pause()
      this.patch({ status: 'paused' })
    } else {
      void this.safePlay()
    }
  }

  play(): void {
    if (!this.snapshot.currentSongId) return
    void this.safePlay()
  }

  pause(): void {
    this.audio?.pause()
    this.patch({ status: 'paused' })
  }

  restart(): void {
    const audio = this.audio
    if (!audio || !this.snapshot.currentSongId) return
    audio.currentTime = 0
    this.patch({ positionMs: 0 })
    void this.safePlay()
  }

  /** Manual next always advances (wrapping); auto next respects repeat-off stop. */
  next(auto = false): void {
    const { index, queue, repeat } = this.snapshot
    if (queue.length === 0) return
    if (auto && repeat === 'one') {
      this.restart()
      return
    }
    if (index >= queue.length - 1) {
      if (auto && repeat !== 'all') return
      this.jumpToIndex(0, true)
      return
    }
    this.jumpToIndex(index + 1, true)
  }

  previous(): void {
    const { index, positionMs } = this.snapshot
    if (index < 0) return
    if (positionMs > 3000) {
      this.restart()
      return
    }
    if (index === 0) {
      this.restart()
      return
    }
    this.jumpToIndex(index - 1, true)
  }

  jumpToIndex(index: number, autoplay = true): void {
    if (index < 0 || index >= this.snapshot.queue.length) return
    this.restoring = !autoplay
    this.patch({ index, positionMs: 0, error: null, status: autoplay ? 'loading' : 'paused' })
    this.loadCurrent(autoplay)
  }

  seekTo(ms: number): void {
    const audio = this.audio
    if (!audio || !this.snapshot.currentSongId) return
    const dur = audio.duration || this.snapshot.durationMs / 1000
    const clamped = Math.min(Math.max(0, ms / 1000), dur || 0)
    try {
      audio.currentTime = clamped
      this.patch({ positionMs: Math.round(clamped * 1000) }, true)
    } catch {
      /* ignore */
    }
  }

  seekBy(deltaMs: number): void {
    this.seekTo(this.snapshot.positionMs + deltaMs)
  }

  setVolume(v: number): void {
    const volume = Math.min(1, Math.max(0, v))
    if (this.audio) {
      this.audio.volume = volume
      if (volume > 0 && this.audio.muted) this.audio.muted = false
    }
    this.patch({ volume, muted: this.audio ? this.audio.muted : volume === 0 })
  }

  setMuted(muted: boolean): void {
    if (this.audio) this.audio.muted = muted
    this.patch({ muted })
  }

  toggleMute(): void {
    this.setMuted(!this.snapshot.muted)
  }

  setShuffle(shuffle: boolean): void {
    const { queue, index } = this.snapshot
    if (queue.length <= 1) {
      this.patch({ shuffle })
      return
    }
    const current = queue[index] ?? null
    if (shuffle) {
      const rest = queue.filter((_, i) => i !== index)
      const shuffled = shuffleArray(rest)
      const nextQueue = current ? [current, ...shuffled] : shuffled
      this.baseQueue = queue
      this.patch({ shuffle: true, queue: nextQueue, index: current ? 0 : 0 })
    } else {
      const base = this.baseQueue ?? queue
      const restoreIndex = current ? base.findIndex((q) => q.queueItemId === current.queueItemId) : index
      this.baseQueue = null
      this.patch({ shuffle: false, queue: base, index: restoreIndex < 0 ? 0 : restoreIndex })
    }
  }

  setRepeat(mode: RepeatMode): void {
    this.patch({ repeat: mode })
  }

  cycleRepeat(): RepeatMode {
    const order: RepeatMode[] = ['off', 'all', 'one']
    const idx = order.indexOf(this.snapshot.repeat)
    const next = order[(idx + 1) % order.length] ?? 'off'
    this.setRepeat(next)
    return next
  }

  /** Append songs to the end of the queue (playing if idle). */
  enqueue(songIds: string[], opts: { playNext?: boolean; playIfIdle?: boolean } = {}): void {
    // Same invariant as playQueue: yt-* ids are never queued into <audio>.
    songIds = songIds.filter((id) => !youtubeVideoId(id))
    if (songIds.length === 0) return
    const items: QueueItem[] = songIds.map((id) => ({ queueItemId: queueItemId(), songId: id }))
    const { queue, index, currentSongId } = this.snapshot
    if (queue.length === 0 || index < 0) {
      void opts
      this.patch({ queue: items, index: 0 })
      return
    }
    let nextQueue: QueueItem[]
    if (opts.playNext) {
      nextQueue = [...queue.slice(0, index + 1), ...items, ...queue.slice(index + 1)]
    } else {
      nextQueue = [...queue, ...items]
    }
    this.baseQueue = this.baseQueue ? [...this.baseQueue, ...items] : null
    this.patch({ queue: nextQueue, currentSongId })
  }

  removeQueueItem(queueItemId: string): void {
    const { queue, index } = this.snapshot
    const target = queue.findIndex((q) => q.queueItemId === queueItemId)
    if (target < 0 || target === index) return // never remove the currently playing item via queue edits
    const nextQueue = queue.filter((q) => q.queueItemId !== queueItemId)
    const nextIndex = target < index ? index - 1 : index
    this.baseQueue = this.baseQueue ? this.baseQueue.filter((q) => q.queueItemId !== queueItemId) : null
    this.patch({ queue: nextQueue, index: nextQueue.length === 0 ? -1 : nextIndex })
    if (nextQueue.length === 0) {
      this.audio?.pause()
      if (this.audio) this.audio.removeAttribute('src')
      this.patch({ status: 'idle', currentSongId: null, positionMs: 0, durationMs: 0 })
    }
  }

  moveQueueItem(from: number, to: number): void {
    const { queue, index } = this.snapshot
    if (from === to || from < 0 || to < 0 || from >= queue.length || to >= queue.length) return
    const current = queue[index]
    const next = [...queue]
    const [item] = next.splice(from, 1)
    if (!item) return
    next.splice(to, 0, item)
    const nextIndex = current ? next.findIndex((q) => q.queueItemId === current.queueItemId) : index
    this.baseQueue = null // order diverged; keep base stale-free
    this.patch({ queue: next, index: nextIndex < 0 ? 0 : nextIndex })
  }

  clearUpcoming(): void {
    const { queue, index, currentSongId } = this.snapshot
    const nextQueue = currentSongId && index >= 0 ? [queue[index]!] : []
    this.baseQueue = null
    this.patch({ queue: nextQueue, index: nextQueue.length ? 0 : -1 })
  }

  /** Discard everything and reset. */
  stop(): void {
    const audio = this.audio
    if (audio) {
      audio.pause()
      audio.removeAttribute('src')
      audio.load()
    }
    this.baseQueue = null
    this.patch({
      status: 'idle',
      currentSongId: null,
      queue: [],
      index: -1,
      positionMs: 0,
      durationMs: 0,
      error: null,
      contextLabel: null,
    })
  }

  /** Re-seed the song map (after playlists change). */
  registerSongs(songs: Song[]): void {
    this.rememberSongs(songs)
  }
}

function shuffleArray<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j]!, a[i]!]
  }
  return a
}

/** App-wide singleton. */
export const player = new PlayerEngine()
