import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Album, Artist, Song } from '@/domain/types'

const { mockCatalog } = vi.hoisted(() => ({
  mockCatalog: {
    getSong: vi.fn(),
    getAlbum: vi.fn(),
    getArtist: vi.fn(),
    getSongsByAlbum: vi.fn(),
    getAlbumsByArtist: vi.fn(),
  },
}))

vi.mock('@/data/catalog-helpers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/data/catalog-helpers')>()
  return { ...actual, getCatalog: () => mockCatalog }
})

import { artistPath } from '@/app/router'
import { artistAnchorHtml, escapeHtml } from '@/ui/el'
import { clearRemoteEntities, registerRemoteEntities } from '@/data/remote-registry'
import { renderSong } from '@/views/song'
import { renderAlbum } from '@/views/album'

const track: Song = {
  id: 'au-song-t1',
  title: 'Test Track',
  albumId: 'au-album-t1',
  artistIds: ['au-artist-real'],
  durationMs: 61_000,
  trackNumber: 1,
  audioUrl: 'https://example.test/audio.mp3',
}

const resolvedArtist: Artist = {
  id: 'au-artist-real',
  name: 'Real Artist',
  artworkSeed: 'au-artist-real',
  genreIds: [],
}

const throttledArtist: Artist = {
  id: 'au-artist-throttle',
  name: 'Throttled Star',
  artworkSeed: 'au-artist-throttle',
  genreIds: [],
}

function albumFixture(artistId: string): Album {
  return {
    id: 'au-album-t1',
    title: 'Fixture Album',
    artistId,
    artworkSeed: 'au-album-t1',
    releaseDate: '2024-01-01',
    genreIds: [],
    kind: 'single',
    songIds: ['au-song-t1'],
  }
}

function mount(): HTMLElement {
  const root = document.createElement('div')
  document.body.appendChild(root)
  return root
}

describe('artistPath', () => {
  it('forms a route for a valid artist id', () => {
    expect(artistPath('au-artist-real')).toBe('/artist/au-artist-real')
    expect(artistPath('a-neon-harbor')).toBe('/artist/a-neon-harbor')
  })

  it('returns null instead of an empty /artist/ route', () => {
    expect(artistPath('')).toBeNull()
    expect(artistPath('   ')).toBeNull()
    expect(artistPath(null)).toBeNull()
    expect(artistPath(undefined)).toBeNull()
    expect(artistPath('undefined')).toBeNull()
    expect(artistPath('null')).toBeNull()
  })
})

describe('artistAnchorHtml', () => {
  it('renders a data-nav anchor when the id is valid', () => {
    expect(artistAnchorHtml('Real Artist', 'au-artist-real')).toBe(
      '<a href="/artist/au-artist-real" data-nav>Real Artist</a>',
    )
  })

  it('renders non-clickable text and never /artist/ when the id is missing', () => {
    for (const id of ['', '   ', null, undefined, 'undefined']) {
      const html = artistAnchorHtml('Unknown Artist', id)
      expect(html).toBe('<span>Unknown Artist</span>')
      expect(html).not.toContain('/artist/')
      expect(html).not.toContain('<a ')
    }
  })

  it('escapes the artist name in both link and text forms', () => {
    expect(artistAnchorHtml('<script>x</script>', 'au-artist-real')).toContain(
      escapeHtml('<script>x</script>'),
    )
    expect(artistAnchorHtml('<script>x</script>', '')).toBe(
      `<span>${escapeHtml('<script>x</script>')}</span>`,
    )
  })
})

describe('renderSong artist byline', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    clearRemoteEntities()
    mockCatalog.getSong.mockResolvedValue(track)
    mockCatalog.getAlbum.mockResolvedValue(null)
    mockCatalog.getSongsByAlbum.mockResolvedValue([])
    mockCatalog.getAlbumsByArtist.mockResolvedValue([])
    registerRemoteEntities({ artists: [resolvedArtist, throttledArtist] })
  })

  it('keeps a working artist link when the id and lookup are valid', async () => {
    mockCatalog.getArtist.mockResolvedValue(resolvedArtist)
    const root = mount()
    await renderSong(root, track.id)

    const link = root.querySelector<HTMLAnchorElement>('.hero-byline a')
    expect(link).not.toBeNull()
    expect(link!.getAttribute('href')).toBe('/artist/au-artist-real')
    expect(link!.hasAttribute('data-nav')).toBe(true)
    expect(link!.textContent).toBe('Real Artist')
    expect(root.innerHTML).not.toContain('href="/artist/"')
  })

  it('degrades gracefully on a failed lookup: keeps the valid route from the song, shows the registry name', async () => {
    mockCatalog.getArtist.mockResolvedValue(null)
    const root = mount()
    await renderSong(root, track.id)

    const link = root.querySelector<HTMLAnchorElement>('.hero-byline a')
    expect(link).not.toBeNull()
    expect(link!.getAttribute('href')).toBe('/artist/au-artist-real')
    expect(root.innerHTML).not.toContain('href="/artist/"')
    expect(root.querySelector('.hero-byline')!.textContent).toBe('Real Artist')
  })

  it('never emits /artist/ for a song with no artist ids', async () => {
    const noIds: Song = { ...track, artistIds: [] }
    mockCatalog.getSong.mockResolvedValue(noIds)
    mockCatalog.getArtist.mockResolvedValue(resolvedArtist)
    const root = mount()
    await renderSong(root, noIds.id)

    expect(mockCatalog.getArtist).not.toHaveBeenCalled()
    expect(root.querySelector('.hero-byline a')).toBeNull()
    expect(root.querySelector('.hero-byline span')!.textContent).toBe('Unknown Artist')
    expect(root.innerHTML).not.toContain('/artist/')
  })

  it('never emits /artist/ for a song with an empty artist id', async () => {
    const emptyId: Song = { ...track, artistIds: [''] }
    mockCatalog.getSong.mockResolvedValue(emptyId)
    const root = mount()
    await renderSong(root, emptyId.id)

    expect(mockCatalog.getArtist).not.toHaveBeenCalled()
    expect(root.querySelector('.hero-byline a')).toBeNull()
    expect(root.innerHTML).not.toContain('/artist/')
    expect(root.querySelector('.hero-byline')).not.toBeNull()
  })
})

describe('renderAlbum artist byline', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    clearRemoteEntities()
    mockCatalog.getSongsByAlbum.mockResolvedValue([])
    mockCatalog.getAlbumsByArtist.mockResolvedValue([])
    mockCatalog.getArtist.mockResolvedValue(null)
  })

  it('keeps a working artist link for a valid album artist id', async () => {
    mockCatalog.getAlbum.mockResolvedValue(albumFixture('au-artist-real'))
    const root = mount()
    await renderAlbum(root, 'au-album-t1')

    const link = root.querySelector<HTMLAnchorElement>('.hero-byline a')
    expect(link).not.toBeNull()
    expect(link!.getAttribute('href')).toBe('/artist/au-artist-real')
    expect(root.innerHTML).not.toContain('href="/artist/"')
  })

  it('renders non-clickable artist text when the album has no artist id', async () => {
    mockCatalog.getAlbum.mockResolvedValue(albumFixture(''))
    const root = mount()
    await renderAlbum(root, 'au-album-t1')

    expect(root.querySelector('.hero-byline a')).toBeNull()
    expect(root.querySelector('.hero-byline span')).not.toBeNull()
    expect(root.innerHTML).not.toContain('/artist/')
  })
})
