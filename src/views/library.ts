/** Library view — playlists, artists, albums, songs, recently added. */

import type { Album, Artist, Playlist, Song } from '@/domain/types'
import { getCatalog, albumArtist } from '@/data/catalog-helpers'
import { libraryStore, createPlaylist } from '@/state/library-store'
import { attachArtworkFallback, on } from '@/ui/el'
import { icon } from '@/ui/icons'
import { albumCardHtml, emptyStateHtml, mediaCardHtml, playlistCardHtml, songRowHtml } from '@/ui/media'
import { openFormDialog } from '@/ui/dialog'
import { router } from '@/app/router-bridge'

const TABS = [
  { id: 'playlists', label: 'Playlists' },
  { id: 'artists', label: 'Artists' },
  { id: 'albums', label: 'Albums' },
  { id: 'songs', label: 'Songs' },
  { id: 'recent', label: 'Recently Added' },
] as const

export async function renderLibrary(root: HTMLElement, tab: string): Promise<void> {
  const active = (TABS.find((t) => t.id === tab) ?? TABS[0])!.id
  root.innerHTML = `<h1 class="page-title">Library</h1><div style="padding:0 40px">${Array.from({ length: 4 }, () => '<div class="skeleton" style="height:160px;margin-bottom:16px;border-radius:10px"></div>').join('')}</div>`

  const catalog = getCatalog()
  const lib = libraryStore.get()

  let contentHtml = ''
  if (active === 'playlists') {
    const users = lib.playlists
    const editorial = (await Promise.all(
      ['pl-deep-focus', 'pl-morning-coffee', 'pl-weekend-drive', 'pl-late-night-code', 'pl-first-light', 'pl-kitchen-soul'].map((id) =>
        catalog.getPlaylist(id),
      ),
    )).filter((p): p is Playlist => Boolean(p))
    const all = [...users, ...editorial]
    contentHtml = all.length
      ? `<div class="library-grid">${all.map((p) => playlistCardHtml(p)).join('')}</div>`
      : emptyStateHtml('note', 'No playlists yet', 'Create a playlist to collect the songs you love.', `<button type="button" class="btn btn-primary" data-action="playlist-create">${icon('plus')} New Playlist</button>`)
  } else if (active === 'artists') {
    const ids = new Set<string>()
    for (const sid of lib.favoriteSongIds) {
      const s = await catalog.getSong(sid)
      s?.artistIds.forEach((a) => ids.add(a))
    }
    for (const pl of lib.playlists) {
      for (const sid of pl.songIds) {
        const s = await catalog.getSong(sid)
        s?.artistIds.forEach((a) => ids.add(a))
      }
    }
    const artists = (await Promise.all([...ids].map((id) => catalog.getArtist(id)))).filter((a): a is Artist => Boolean(a))
    contentHtml = artists.length
      ? `<div class="library-grid">${artists.map((a) => mediaCardHtml({ id: a.id, title: a.name, sub: 'Artist', seed: a.artworkSeed, href: `/artist/${a.id}` })).join('')}</div>`
      : emptyStateHtml('library', 'No artists yet', 'Favorite songs or build playlists and your artists will gather here.')
  } else if (active === 'albums') {
    const ids = new Set<string>(lib.recentlyAddedAlbumIds)
    for (const sid of lib.favoriteSongIds) {
      const s = await catalog.getSong(sid)
      if (s) ids.add(s.albumId)
    }
    const albums = (await Promise.all([...ids].map((id) => catalog.getAlbum(id)))).filter((a): a is Album => Boolean(a))
    contentHtml = albums.length
      ? `<div class="library-grid">${albums.map((a) => albumCardHtml(a, albumArtist(a))).join('')}</div>`
      : emptyStateHtml('note', 'No albums yet', 'Play an album and it will appear under Recently Added.')
  } else if (active === 'songs') {
    const songs = (await Promise.all(lib.favoriteSongIds.map((id) => catalog.getSong(id)))).filter((s): s is Song => Boolean(s))
    contentHtml = songs.length
      ? `<div class="list-rows" data-song-list role="list">${songs.map((s) => songRowHtml(s, { context: 'library-songs' })).join('')}</div>`
      : emptyStateHtml('heart', 'No favorite songs', 'Tap the heart on any song to save it here.', `<a class="btn btn-primary" href="/browse" data-nav> Browse Music </a>`)
  } else {
    const albums = (await Promise.all(lib.recentlyAddedAlbumIds.map((id) => catalog.getAlbum(id)))).filter((a): a is Album => Boolean(a))
    contentHtml = albums.length
      ? `<div class="library-grid">${albums.map((a) => albumCardHtml(a, albumArtist(a))).join('')}</div>`
      : emptyStateHtml('note', 'Nothing played yet', 'Albums you play will be added here automatically.')
  }

  root.innerHTML = `
    <h1 class="page-title">Library</h1>
    <div class="page-actions">
      <button type="button" class="btn btn-secondary" data-action="playlist-create">${icon('plus')} New Playlist</button>
    </div>
    <div class="tabs-row" role="tablist" aria-label="Library sections">
      ${TABS.map((t) => `<a class="chip" role="tab" aria-selected="${t.id === active}" href="/library?tab=${t.id}" data-nav>${t.label}</a>`).join('')}
    </div>
    ${contentHtml}`
  attachArtworkFallback(root)

  on(root, 'click', '[data-action="playlist-create"]', () => {
    openFormDialog({
      title: 'New Playlist',
      fields: [
        { name: 'title', label: 'Playlist name', type: 'text', required: true, maxLength: 60, placeholder: 'My playlist' },
        { name: 'description', label: 'Description (optional)', type: 'textarea', maxLength: 180 },
      ],
      submitLabel: 'Create',
      onSubmit: (values) => {
        const title = values['title'] ?? ''
        if (!title) return 'Please enter a name.'
        const created = createPlaylist(title, values['description'] ?? '')
        router.navigate(`/playlist/${created.id}`)
        return null
      },
    })
  })
}
