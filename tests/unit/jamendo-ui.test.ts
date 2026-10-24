import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Song } from '@/domain/types'

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

import { clearRemoteEntities, registerRemoteEntities } from '@/data/remote-registry'
import { songRowHtml } from '@/ui/media'
import { renderSong } from '@/views/song'

const jamendoSong: Song = {
  id: 'jm-song-1848357',
  title: 'Harbor Lights',
  albumId: 'jm-album-368084',
  artistIds: ['jm-artist-421168'],
  durationMs: 181_000,
  trackNumber: 1,
  audioUrl: 'https://prod-1.storage.jamendo.com/?trackid=1848357&format=mp32',
  source: 'jamendo',
  playbackKind: 'audio',
  artworkUrl: 'https://usercontent.jamendo.com?type=album&id=368084',
  externalUrl: 'https://www.jamendo.com/track/1848357',
  attribution: 'Jamendo',
  attributionUrl: 'http://creativecommons.org/licenses/by-nc-nd/3.0/',
}

const demoSong: Song = {
  id: 's-mg-1',
  title: 'Demo Song',
  albumId: 'al-mg-1',
  artistIds: ['a-neon-harbor'],
  durationMs: 60_000,
  trackNumber: 1,
  audioUrl: 'https://example.test/demo.mp3',
}

beforeEach(() => {
  document.body.innerHTML = ''
  clearRemoteEntities()
  mockCatalog.getSong.mockResolvedValue(null)
  mockCatalog.getAlbum.mockResolvedValue(null)
  mockCatalog.getArtist.mockResolvedValue(null)
  mockCatalog.getSongsByAlbum.mockResolvedValue([])
  mockCatalog.getAlbumsByArtist.mockResolvedValue([])
})

describe('song row source badge', () => {
  it('stamps a Jamendo badge on provider rows', () => {
    const html = songRowHtml(jamendoSong, { context: 'search' })
    expect(html).toContain('source-badge')
    expect(html).toContain('>Jamendo</span>')
    expect(html).toContain('Source: Jamendo')
    expect(html).toContain('data-song-id="jm-song-1848357"')
    expect(html).toContain('Harbor Lights')
  })

  it('keeps demo rows badge-free (unchanged visual identity)', () => {
    const html = songRowHtml(demoSong, { context: 'search' })
    expect(html).not.toContain('source-badge')
    expect(html).not.toContain('Jamendo')
  })
})

describe('renderSong licence/attribution line', () => {
  it('shows the source, the CC licence link derived from the URL, and the source page', async () => {
    registerRemoteEntities({
      songs: [jamendoSong],
      artists: [{ id: 'jm-artist-421168', name: 'Ada', artworkSeed: 'jm-artist-421168', genreIds: [] }],
    })
    mockCatalog.getSong.mockResolvedValue(jamendoSong)
    const root = document.createElement('div')
    document.body.appendChild(root)
    await renderSong(root, jamendoSong.id)

    const license = root.querySelector('.hero-license')
    expect(license).not.toBeNull()
    expect(license!.textContent).toContain('Jamendo')
    const links = Array.from(license!.querySelectorAll('a'))
    const byNcNd = links.find((a) => a.getAttribute('href')?.includes('creativecommons.org'))
    expect(byNcNd?.textContent).toBe('CC BY-NC-ND') // derived from the licence URL itself
    expect(byNcNd?.getAttribute('rel')).toContain('noopener')
    const page = links.find((a) => a.getAttribute('href') === 'https://www.jamendo.com/track/1848357')
    expect(page?.textContent).toBe('View on Jamendo')
    // Artist credit sits in the byline (CC attribution requirement).
    expect(root.querySelector('.hero-byline')!.textContent).toBe('Ada')
  })

  it('renders no attribution line for demo songs (no licence claimed)', async () => {
    mockCatalog.getSong.mockResolvedValue(demoSong)
    const root = document.createElement('div')
    document.body.appendChild(root)
    await renderSong(root, demoSong.id)
    expect(root.querySelector('.hero-license')).toBeNull()
  })

  it('keeps the no-artist guard for a Jamendo track without artist ids', async () => {
    const orphan: Song = { ...jamendoSong, artistIds: [] }
    registerRemoteEntities({ songs: [orphan] })
    mockCatalog.getSong.mockResolvedValue(orphan)
    const root = document.createElement('div')
    document.body.appendChild(root)
    await renderSong(root, orphan.id)

    expect(mockCatalog.getArtist).not.toHaveBeenCalled()
    expect(root.querySelector('.hero-byline a')).toBeNull()
    expect(root.querySelector('.hero-byline span')!.textContent).toBe('Unknown Artist')
    expect(root.innerHTML).not.toContain('/artist/')
    expect(root.querySelector('.hero-license')).not.toBeNull() // attribution still shown
  })
})
