/** Global delegated actions (transport, contexts, menus, favorites). */

import { player } from '@/engine/player'
import { router } from '@/app/router-bridge'
import { getCatalog, songById, artistById } from '@/data/catalog-helpers'
import { getUserPlaylist, libraryStore, isFavoriteSong, addSongsToPlaylist, removeSongFromPlaylist } from '@/state/library-store'
import { setThemePref } from '@/state/prefs-store'
import { providerInfos } from '@/data/catalog'
import { toggleFavorite } from '@/actions/favorites'
import { resolveSongIds } from '@/ui/media'
import { openContextualMenu, type MenuItem } from '@/ui/menu'
import { openFormDialog } from '@/ui/dialog'
import { showToast } from '@/ui/toast'
import { createPlaylist } from '@/state/library-store'
import { on, qs } from '@/ui/el'
import { icon } from '@/ui/icons'
import { youtubeVideoId } from '@/data/youtube-normalize'
import type { Song } from '@/domain/types'

export interface PlayCollectionOptions {
  shuffle?: boolean
  startSongId?: string
}

/**
 * YouTube videos play only on the `/watch` embed page — never through the
 * <audio> engine. Every entry point that would otherwise queue one routes
 * here instead (policy decision: README “YouTube integration”).
 */
function tryWatchRoute(songId: string | null | undefined): boolean {
  if (!songId || !youtubeVideoId(songId)) return false
  router.navigate(`/watch/${songId}`)
  return true
}

export async function playCollection(kind: string, id: string, opts: PlayCollectionOptions = {}): Promise<void> {
  const catalog = getCatalog()
  let songs: Song[] = []
  let label = ''
  switch (kind) {
    case 'album': {
      const album = await catalog.getAlbum(id)
      songs = await catalog.getSongsByAlbum(id)
      label = album?.title ?? 'Album'
      break
    }
    case 'playlist': {
      const user = getUserPlaylist(id)
      const pl = user ?? (await catalog.getPlaylist(id))
      songs = await resolveSongIds(pl?.songIds ?? [])
      label = pl?.title ?? 'Playlist'
      break
    }
    case 'station': {
      const st = await catalog.getStation(id)
      songs = await resolveSongIds(st?.songIds ?? [])
      label = st?.name ?? 'Station'
      break
    }
    case 'artist': {
      songs = await catalog.getTopSongsByArtist(id)
      label = artistById(id)?.name ?? 'Artist'
      break
    }
    case 'favorites': {
      songs = await resolveSongIds(libraryStore.get().favoriteSongIds)
      label = 'Favorites'
      break
    }
    default:
      return
  }
  // Favorites/playlists may contain YouTube ids (e.g. favorited from search);
  // they are skipped here and guarded again inside player.playQueue.
  songs = songs.filter((s) => s.playbackKind !== 'youtube')
  if (songs.length === 0) {
    showToast({ message: 'Nothing to play here yet.' })
    return
  }
  if (opts.shuffle) player.setShuffle(true)
  const startIndex = opts.startSongId ? Math.max(0, songs.findIndex((s) => s.id === opts.startSongId)) : 0
  player.playQueue(songs, startIndex, { contextLabel: label })
}

function collectListFromDom(row: HTMLElement): { songs: Song[]; startIndex: number } {
  const list = row.closest('[data-song-list]')
  const ids = list
    ? [...list.querySelectorAll<HTMLElement>('.song-row[data-song-id]')].map((r) => r.getAttribute('data-song-id') ?? '')
    : [row.getAttribute('data-song-id') ?? '']
  const playableIds = ids.filter((id) => !youtubeVideoId(id))
  const startIndex = Math.max(0, playableIds.indexOf(row.getAttribute('data-song-id') ?? ''))
  const songs = playableIds.map((id) => songById(id)).filter((s): s is Song => Boolean(s))
  return { songs, startIndex }
}

async function playRow(row: HTMLElement): Promise<void> {
  const songId = row.getAttribute('data-song-id')
  if (!songId) return
  if (tryWatchRoute(songId)) return
  const { songs, startIndex } = collectListFromDom(row)
  if (songs.length === 0) {
    const s = await getCatalog().getSong(songId)
    if (s) player.playQueue([s], 0, { contextLabel: 'Song' })
    return
  }
  player.playQueue(songs, startIndex, { contextLabel: null })
}

export function bindGlobalActions(root: HTMLElement): () => void {
  const unsubs = [
    on(root, 'click', '.song-row', (row, ev) => {
      if ((ev.target as Element).closest('button, a, input')) return
      void playRow(row)
    }),
    on(root, 'keydown', '.song-row', (row, ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault()
        void playRow(row)
      }
    }),
    on(root, 'click', '[data-action="play-song"]', (el) => {
      const songId = el.getAttribute('data-song-id')
      if (!songId) return
      if (tryWatchRoute(songId)) return
      const row = el.closest<HTMLElement>('.song-row') ?? root.querySelector<HTMLElement>(`.song-row[data-song-id="${CSS.escape(songId)}"]`)
      if (row) void playRow(row)
      else {
        void (async () => {
          const s = await getCatalog().getSong(songId)
          if (s) player.playQueue([s], 0, { contextLabel: 'Song' })
        })()
      }
    }),
    on(root, 'click', '[data-action="play-context"]', (el) => {
      const kind = el.getAttribute('data-kind') ?? ''
      const id = el.getAttribute('data-id') ?? ''
      const shuffle = el.getAttribute('data-shuffle') === 'true'
      const songId = el.getAttribute('data-song-id')
      void playCollection(kind, id, { shuffle, startSongId: songId ?? undefined })
    }),
    on(root, 'click', '[data-action="toggle-play"]', () => player.togglePlay()),
    on(root, 'click', '[data-action="player-next"]', () => player.next()),
    on(root, 'click', '[data-action="player-prev"]', () => player.previous()),
    on(root, 'click', '[data-action="toggle-shuffle"]', () => {
      player.setShuffle(!player.getSnapshot().shuffle)
      showToast({ message: player.getSnapshot().shuffle ? 'Shuffle on' : 'Shuffle off', durationMs: 1600 })
    }),
    on(root, 'click', '[data-action="cycle-repeat"]', () => {
      const mode = player.cycleRepeat()
      showToast({ message: mode === 'off' ? 'Repeat off' : mode === 'all' ? 'Repeat all' : 'Repeat one', durationMs: 1600 })
    }),
    on(root, 'click', '[data-action="toggle-mute"]', () => player.toggleMute()),
    on(root, 'click', '[data-action="enqueue-song"]', (el) => {
      const id = el.getAttribute('data-song-id')
      if (!id) return
      if (tryWatchRoute(id)) return
      const snap = player.getSnapshot()
      if (snap.queue.length === 0) {
        void (async () => {
          const s = await getCatalog().getSong(id)
          if (s) {
            player.playQueue([s], 0, { contextLabel: 'Queue' })
            showToast({ message: 'Playing now' })
          }
        })()
        return
      }
      player.enqueue([id])
      showToast({ message: 'Added to queue' })
    }),
    on(root, 'click', '[data-action="fav-song"]', (el) => {
      const id = el.getAttribute('data-song-id')
      if (!id) return
      const now = toggleFavorite(id)
      el.innerHTML = icon(now ? 'heart-fill' : 'heart')
      el.setAttribute('aria-pressed', String(now))
    }),
    on(root, 'click', '[data-action="song-menu"]', (el) => openSongMenu(el)),
    on(root, 'click', '[data-action="settings"]', () => openSettings()),
  ]
  return () => unsubs.forEach((u) => u())
}

function openSongMenu(anchor: HTMLElement): void {
  const songId = anchor.getAttribute('data-song-id') ?? ''
  const queueItemId = anchor.getAttribute('data-queue-item-id')
  const song = songById(songId)
  if (!song) return
  const row = anchor.closest<HTMLElement>('.song-row')
  const context = row?.getAttribute('data-context') ?? ''
  const fav = isFavoriteSong(songId)
  const isYoutube = Boolean(youtubeVideoId(songId))

  const items: MenuItem[] = []
  if (isYoutube) {
    // Queue actions are replaced by the watch route: a YouTube video is never
    // a queue item — it plays only through its visible official embed.
    items.push({
      label: 'Watch on YouTube',
      onSelect: () => router.navigate(`/watch/${songId}`),
    })
  } else {
    items.push({
      label: 'Play Next',
      onSelect: () => {
        const snap = player.getSnapshot()
        if (snap.queue.length === 0) player.playQueue([song], 0, { contextLabel: 'Queue' })
        else {
          player.enqueue([songId], { playNext: true })
          showToast({ message: 'Playing next' })
        }
      },
    })
    items.push({
      label: 'Add to Queue',
      onSelect: () => {
        const snap = player.getSnapshot()
        if (snap.queue.length === 0) player.playQueue([song], 0, { contextLabel: 'Queue' })
        else {
          player.enqueue([songId])
          showToast({ message: 'Added to queue' })
        }
      },
    })
  }
  items.push(
    {
      label: fav ? 'Remove from Favorites' : 'Favorite',
      onSelect: () => {
        toggleFavorite(songId)
      },
    },
    {
      label: 'Add to Playlist…',
      onSelect: () => openAddToPlaylistDialog(songId),
    },
    { separator: true as const },
    {
      label: 'Go to Album',
      onSelect: () => router.navigate(`/album/${song.albumId}`),
    },
  )
  if (song.artistIds[0]) {
    items.push({
      label: 'Go to Artist',
      onSelect: () => router.navigate(`/artist/${song.artistIds[0]}`),
    })
  }
  if (context.startsWith('playlist:')) {
    const plId = context.slice('playlist:'.length)
    const pl = getUserPlaylist(plId)
    if (pl?.isUserPlaylist) {
      items.push({ separator: true as const })
      items.push({
        label: 'Remove from Playlist',
        danger: true,
        onSelect: () => {
          removeSongFromPlaylist(plId, songId)
          showToast({ message: 'Removed from playlist' })
          location.reload()
        },
      })
    }
  }
  if (queueItemId) {
    items.push({ separator: true as const })
    items.push({
      label: 'Remove from Queue',
      danger: true,
      onSelect: () => player.removeQueueItem(queueItemId),
    })
  }
  openContextualMenu(anchor, items)
}

function openAddToPlaylistDialog(songId: string): void {
  const playlists = libraryStore.get().playlists
  openFormDialog({
    title: 'Add to Playlist',
    fields: [
      {
        name: 'target',
        label: 'Choose playlist',
        type: 'text',
        required: true,
        placeholder: playlists[0]?.title ?? 'Playlist name',
      },
    ],
    submitLabel: 'Add',
    onSubmit: (values) => {
      const q = (values['target'] ?? '').toLowerCase()
      if (!q) return 'Enter a playlist name.'
      let target = playlists.find((p) => p.title.toLowerCase() === q)
      if (!target) target = createPlaylist(values['target']!)
      const added = addSongsToPlaylist(target.id, [songId])
      showToast({ message: added ? `Added to “${target.title}”` : 'Already in that playlist' })
      return null
    },
  })
}

function openSettings(): void {
  const snap = player.getSnapshot()
  const providers = providerInfos()
  openFormDialog({
    title: 'Settings & About',
    fields: [
      {
        name: 'theme',
        label: 'Appearance (system / light / dark — type one)',
        type: 'text',
        value: document.documentElement.getAttribute('data-theme') ?? 'system',
        maxLength: 10,
      },
    ],
    submitLabel: 'Save',
    onSubmit: (values) => {
      const t = (values['theme'] ?? '').toLowerCase()
      if (t === 'light' || t === 'dark' || t === 'system') setThemePref(t)
      return null
    },
  })
  // Append provider info + shortcuts beneath the dialog content
  const dlg = document.querySelector('dialog.sheet .dialog-body')
  if (dlg) {
    const info = document.createElement('div')
    info.style.cssText = 'font-size:12px;color:var(--color-text-secondary);line-height:1.5'
    info.innerHTML = `
      <strong>Catalogue providers</strong><br/>
      ${providers.map((p) => `${p.name}: ${p.configured ? 'configured' : 'off'} — ${p.description}`).join('<br/>')}<br/><br/>
      <strong>Keyboard</strong><br/>
      Space play/pause · ←/→ seek 5s · ↑/↓ volume · M mute · N/P next/prev · S shuffle · R repeat · Q queue · / search<br/><br/>
      Sonora is an independent demo inspired by modern music web players. Not affiliated with Apple.
      Demo audio: SoundHelix.com. Current queue: ${snap.contextLabel ?? '—'}`
    dlg.appendChild(info)
  }
}

export { qs }
