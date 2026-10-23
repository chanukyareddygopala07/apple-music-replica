import { describe, expect, it } from 'vitest'
import { parseLocation, routeKey, stripBase, withBase } from '@/app/router'

describe('parseLocation', () => {
  it('maps top-level paths', () => {
    expect(parseLocation({ pathname: '/' })).toEqual({ name: 'home' })
    expect(parseLocation({ pathname: '/browse' })).toEqual({ name: 'browse' })
    expect(parseLocation({ pathname: '/radio' })).toEqual({ name: 'radio' })
  })

  it('tolerates trailing slashes', () => {
    expect(parseLocation({ pathname: '/' })).toEqual({ name: 'home' })
    expect(parseLocation({ pathname: '/browse/' })).toEqual({ name: 'browse' })
  })

  it('reads search and library params', () => {
    expect(parseLocation({ pathname: '/search', search: '?q=harbor' })).toEqual({ name: 'search', q: 'harbor' })
    expect(parseLocation({ pathname: '/search' })).toEqual({ name: 'search', q: '' })
    expect(parseLocation({ pathname: '/library', search: '?tab=songs' })).toEqual({ name: 'library', tab: 'songs' })
    expect(parseLocation({ pathname: '/library' })).toEqual({ name: 'library', tab: 'playlists' })
  })

  it('parses detail routes', () => {
    expect(parseLocation({ pathname: '/album/al-tidal-lines' })).toEqual({ name: 'album', id: 'al-tidal-lines' })
    expect(parseLocation({ pathname: '/artist/a-marigold' })).toEqual({ name: 'artist', id: 'a-marigold' })
    expect(parseLocation({ pathname: '/playlist/pl-deep-focus' })).toEqual({ name: 'playlist', id: 'pl-deep-focus' })
    expect(parseLocation({ pathname: '/song/s-tl-1' })).toEqual({ name: 'song', id: 's-tl-1' })
    expect(parseLocation({ pathname: '/genre/g-pop' })).toEqual({ name: 'genre', id: 'g-pop' })
  })

  it('defaults unknown paths to not-found', () => {
    expect(parseLocation({ pathname: '/nope' })).toEqual({ name: 'not-found', path: '/nope' })
  })

  it('handles now-playing panel param', () => {
    expect(parseLocation({ pathname: '/now-playing', search: '?panel=queue' })).toEqual({
      name: 'now-playing',
      panel: 'queue',
    })
    expect(parseLocation({ pathname: '/now-playing' })).toEqual({ name: 'now-playing', panel: 'lyrics' })
  })
})

describe('routeKey', () => {
  it('builds stable keys per route identity', () => {
    expect(routeKey({ name: 'home' })).toBe('home')
    expect(routeKey({ name: 'search', q: 'x' })).toBe('search:x')
    expect(routeKey({ name: 'library', tab: 'songs' })).toBe('library:songs')
    expect(routeKey({ name: 'album', id: 'a1' })).toBe('album:a1')
    expect(routeKey({ name: 'now-playing', panel: 'queue' })).toBe('now-playing:queue')
  })
})

describe('base path helpers', () => {
  const base = '/apple-music-replica/'

  it('strips the deploy base for route parsing', () => {
    expect(stripBase('/apple-music-replica/', base)).toBe('/')
    expect(stripBase('/apple-music-replica', base)).toBe('/')
    expect(stripBase('/apple-music-replica/album/al-1', base)).toBe('/album/al-1')
    expect(stripBase('/album/al-1', base)).toBe('/album/al-1')
    expect(stripBase('/apple-music-replica-2/album/al-1', base)).toBe('/apple-music-replica-2/album/al-1')
  })

  it('is a no-op when base is root', () => {
    expect(stripBase('/album/al-1')).toBe('/album/al-1')
    expect(withBase('/album/al-1')).toBe('/album/al-1')
  })

  it('prefixes history paths with the deploy base', () => {
    expect(withBase('/album/al-1', base)).toBe('/apple-music-replica/album/al-1')
    expect(withBase('/', base)).toBe('/apple-music-replica/')
    expect(withBase('/search?q=x', base)).toBe('/apple-music-replica/search?q=x')
    expect(withBase('/apple-music-replica/album/al-1', base)).toBe('/apple-music-replica/album/al-1')
  })

  it('parses routes from full Pages pathnames', () => {
    expect(stripBase('/apple-music-replica/album/al-tidal-lines', base)).toBe('/album/al-tidal-lines')
    expect(parseLocation({ pathname: stripBase('/apple-music-replica/radio', base) })).toEqual({ name: 'radio' })
  })
})
