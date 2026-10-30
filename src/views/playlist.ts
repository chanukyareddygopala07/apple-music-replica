/** Playlist view — editorial + user playlists with editing for user lists. */

import type { Playlist, Song } from '@/domain/types'
import { getCatalog } from '@/data/catalog-helpers'
import { addSongsToPlaylist, deletePlaylist, getUserPlaylist, updatePlaylist } from '@/state/library-store'
import { attachArtworkFallback, on } from '@/ui/el'
import { icon } from '@/ui/icons'
import { emptyStateHtml, songRowHtml, applyHeroTheme, skeletonRowsHtml, resolveSongIds } from '@/ui/media'
import { confirmDialog, openFormDialog } from '@/ui/dialog'
import { openContextualMenu } from '@/ui/menu'
import { showToast } from '@/ui/toast'
import { formatSongCount } from '@/utils/format'
import { router } from '@/app/router-bridge'
import { player } from '@/engine/player'

export async function renderPlaylist(root: HTMLElement, id: string): Promise<void> {
  root.innerHTML = `<div style="padding:48px 40px">${skeletonRowsHtml(5)}</div>`
  const catalog = getCatalog()
  const userPl = getUserPlaylist(id)
  const pl: Playlist | null = userPl ?? (await catalog.getPlaylist(id))
  if (!pl) {
    root.innerHTML = emptyStateHtml('note', 'Playlist not found', 'It may have been deleted.')
    return
  }
  const songs: Song[] = await resolveSongIds(pl.songIds)
  player.registerSongs(songs)

  root.classList.add('theme-page')
  applyHeroTheme(root, pl.artworkSeed)

  const totalMs = songs.reduce((s, x) => s + x.durationMs, 0)
  const rowsHtml = songs.map((s, i) => songRowHtml(s, { index: i, context: `playlist:${pl!.id}` })).join('')

  root.innerHTML = `
    <div class="detail-hero">
      <img class="hero-art" src="" data-seed="${pl.artworkSeed}" alt="Cover of ${pl.title.replaceAll('"', '')}" />
      <div class="hero-info">
        <div class="hero-kicker">${pl.isUserPlaylist ? 'Playlist' : 'Realaxify Playlist'}</div>
        <h1>${pl.title.replaceAll('<', '&lt;')}</h1>
        ${pl.curator ? `<div class="hero-meta">${pl.curator.replaceAll('<', '&lt;')}</div>` : ''}
        ${pl.description ? `<p class="hero-desc">${pl.description.replaceAll('<', '&lt;')}</p>` : ''}
        <div class="hero-meta">${formatSongCount(songs.length)}${songs.length ? ` · ${Math.round(totalMs / 60000)} min` : ''}</div>
        <div class="hero-actions">
          <button type="button" class="btn btn-play-hero" data-action="play-context" data-kind="playlist" data-id="${pl.id}" ${songs.length ? '' : 'disabled'}>${icon('play')} Play</button>
          <button type="button" class="btn btn-secondary" data-action="play-context" data-kind="playlist" data-id="${pl.id}" data-shuffle="true" ${songs.length ? '' : 'disabled'}>${icon('shuffle')} Shuffle</button>
          ${
            pl.isUserPlaylist
              ? `<button type="button" class="icon-btn lg on-theme" data-action="playlist-edit" data-playlist-id="${pl.id}" aria-label="Edit playlist">${icon('more')}</button>`
              : ''
          }
        </div>
      </div>
    </div>
    ${
      songs.length
        ? `<div class="track-list" data-song-list role="list" aria-label="Tracks">${rowsHtml}</div>`
        : emptyStateHtml('note', 'No songs yet', 'Add songs from any album using the ••• menu.', `<a class="btn btn-secondary" href="/browse" data-nav>Browse</a>`)
    }
    <div style="height:40px"></div>`
  attachArtworkFallback(root)

  on(root, 'click', '[data-action="playlist-edit"]', (el) => {
    const plId = el.getAttribute('data-playlist-id') ?? pl!.id
    openContextualPlaylistMenu(el, plId, () => {
      void renderPlaylist(root, id)
    })
  })
}

function openContextualPlaylistMenu(anchor: HTMLElement, playlistId: string, onChanged: () => void): void {
  openContextualMenu(anchor, [
      {
        label: 'Rename…',
        onSelect: () => {
          const pl = getUserPlaylist(playlistId)
          if (!pl) return
          openFormDialog({
            title: 'Edit Playlist',
            fields: [
              { name: 'title', label: 'Name', type: 'text', value: pl.title, required: true, maxLength: 60 },
              { name: 'description', label: 'Description', type: 'textarea', value: pl.description, maxLength: 180 },
            ],
            submitLabel: 'Save',
            onSubmit: (values) => {
              if (!values['title']) return 'Please enter a name.'
              updatePlaylist(playlistId, { title: values['title']!, description: values['description'] ?? '' })
              onChanged()
              return null
            },
          })
        },
      },
      { label: 'Delete Playlist', danger: true, onSelect: () => {
        void confirmDialog({
          title: 'Delete playlist?',
          message: 'This removes the playlist from your library. Songs stay in the catalogue.',
          confirmLabel: 'Delete',
          danger: true,
        }).then((ok) => {
          if (!ok) return
          deletePlaylist(playlistId)
          showToast({ message: 'Playlist deleted' })
          router.navigate('/library?tab=playlists')
        })
      } },
  ])
}

/** Exposed for actions: add a song into a user playlist with feedback. */
export function addSongToUserPlaylist(playlistId: string, songId: string): void {
  const added = addSongsToPlaylist(playlistId, [songId])
  showToast({ message: added ? 'Added to playlist' : 'Song is already in that playlist' })
}
