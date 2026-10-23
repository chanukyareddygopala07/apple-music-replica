import { describe, expect, it } from 'vitest'
import type { AudiusRawPlaylist, AudiusRawTrack, AudiusRawUser } from '@/data/audius-client'
import {
  AU_SONG,
  albumFromPlaylist,
  albumFromTrack,
  artworkUrl,
  audiusRawId,
  isPlayable,
  playlistContentIds,
  toArtist,
  toPlaylist,
  toSong,
} from '@/data/audius-normalize'

const rawTrack: AudiusRawTrack = {
  id: '6RN8l',
  title: 'Harbor Lights',
  duration: 181.5,
  artwork: {
    '150x150': 'https://images.audius.co/a150.jpg',
    '480x480': 'https://images.audius.co/a480.jpg',
    '1000x1000': 'https://images.audius.co/a1000.jpg',
  },
  user: { id: 'd08dP', name: 'Ada', handle: 'ada' },
}

const rawUser: AudiusRawUser = {
  id: 'd08dP',
  name: 'Ada',
  handle: 'ada',
  bio: 'Making music.',
  profile_picture: { '150x150': 'https://images.audius.co/p150.jpg' },
}

describe('artworkUrl', () => {
  it('prefers the largest available size and only accepts http(s)', () => {
    expect(artworkUrl(rawTrack.artwork)).toBe('https://images.audius.co/a1000.jpg')
    expect(artworkUrl({ '480x480': 'https://x.example/480.jpg' })).toBe('https://x.example/480.jpg')
    expect(artworkUrl({ '1000x1000': 'not-a-url' })).toBeUndefined()
    expect(artworkUrl(undefined)).toBeUndefined()
    expect(artworkUrl('nope')).toBeUndefined()
  })

  it('accepts SDK-shaped underscore keys', () => {
    expect(artworkUrl({ '_480x480': 'https://x.example/sdk.jpg' })).toBe('https://x.example/sdk.jpg')
  })
})

describe('audiusRawId', () => {
  it('round-trips domain ids and rejects other prefixes', () => {
    expect(audiusRawId(`${AU_SONG}6RN8l`, AU_SONG)).toBe('6RN8l')
    expect(audiusRawId('s-mg-1', AU_SONG)).toBeNull()
    expect(audiusRawId(AU_SONG, AU_SONG)).toBeNull()
  })
})

describe('isPlayable', () => {
  it('drops deleted, unlisted, unstreamable and gated tracks', () => {
    expect(isPlayable(rawTrack)).toBe(true)
    expect(isPlayable({ ...rawTrack, is_delete: true })).toBe(false)
    expect(isPlayable({ ...rawTrack, is_unlisted: true })).toBe(false)
    expect(isPlayable({ ...rawTrack, is_streamable: false })).toBe(false)
    expect(isPlayable({ ...rawTrack, is_stream_gated: true })).toBe(false)
    expect(isPlayable({ id: '' })).toBe(false)
  })
})

describe('toSong', () => {
  it('maps ids, duration (s→ms), artwork URL and artist ids', () => {
    const song = toSong(rawTrack)
    expect(song).toMatchObject({
      id: 'au-song-6RN8l',
      title: 'Harbor Lights',
      albumId: 'au-album-t-6RN8l',
      artistIds: ['au-artist-d08dP'],
      durationMs: 181_500,
      artworkUrl: 'https://images.audius.co/a1000.jpg',
      audioUrl: '',
    })
  })

  it('tolerates missing metadata (title/duration/user) without throwing', () => {
    const song = toSong({ id: 'x' })
    expect(song).toMatchObject({ title: 'Untitled', durationMs: 0, artistIds: [] })
    expect(song?.artworkUrl).toBeUndefined()
  })

  it('returns null for unplayable or missing tracks', () => {
    expect(toSong(null)).toBeNull()
    expect(toSong(undefined)).toBeNull()
    expect(toSong({ ...rawTrack, is_stream_gated: true })).toBeNull()
  })
})

describe('toArtist', () => {
  it('maps name, bio and remote profile picture as artworkSeed', () => {
    const artist = toArtist(rawUser)
    expect(artist).toEqual({
      id: 'au-artist-d08dP',
      name: 'Ada',
      artworkSeed: 'https://images.audius.co/p150.jpg',
      bio: 'Making music.',
      genreIds: [],
    })
  })

  it('falls back to handle and a generated seed', () => {
    const artist = toArtist({ id: 'u1', handle: 'first_name' })
    expect(artist).toMatchObject({ name: 'first_name', artworkSeed: 'au-user-u1' })
    expect(toArtist(null)).toBeNull()
    expect(toArtist({ id: '' })).toBeNull()
  })
})

describe('albumFromTrack / albumFromPlaylist', () => {
  it('synthesises a deterministic single-track album per track', () => {
    const album = albumFromTrack(rawTrack)
    expect(album).toMatchObject({
      id: 'au-album-t-6RN8l',
      title: 'Harbor Lights',
      artistId: 'au-artist-d08dP',
      kind: 'single',
      songIds: ['au-song-6RN8l'],
      artworkSeed: 'https://images.audius.co/a1000.jpg',
    })
    expect(albumFromTrack({ ...rawTrack, artwork: undefined })?.artworkSeed).toBe('au-album-t-6RN8l')
    expect(albumFromTrack({ ...rawTrack, is_delete: true })).toBeNull()
  })

  it('maps an artist album playlist (is_album) with content ids', () => {
    const album = albumFromPlaylist({
      id: 'PlkNm',
      playlist_name: 'First Light',
      user_id: 'd08dP',
      playlist_contents: [{ track_id: 'aaa' }, { track_id: 'bbb' }],
      release_date: '2025-05-01',
    })
    expect(album).toMatchObject({
      id: 'au-album-p-PlkNm',
      title: 'First Light',
      artistId: 'au-artist-d08dP',
      kind: 'album',
      songIds: ['au-song-aaa', 'au-song-bbb'],
      releaseDate: '2025-05-01',
    })
    expect(albumFromPlaylist(null)).toBeNull()
  })
})

describe('playlistContentIds / toPlaylist', () => {
  const rawPlaylist: AudiusRawPlaylist = {
    id: 'Dv9QV',
    playlist_name: 'MONKEYS CHILL',
    description: 'deep cuts',
    artwork: { '480x480': 'https://images.audius.co/pl480.jpg' },
    user: { id: 'u9', name: 'SMB', handle: 'smb' },
    is_album: false,
    playlist_contents: [
      { track_id: 'J5NMd', timestamp: 1630795255 },
      { track_id: 'JbXXp', timestamp: 1630796490 },
    ],
    created_at: '2021-09-04T14:40:55Z',
  }

  it('reads track ids from playlist_contents (list shape)', () => {
    expect(playlistContentIds(rawPlaylist)).toEqual(['au-song-J5NMd', 'au-song-JbXXp'])
  })

  it('falls back to embedded tracks when contents are empty', () => {
    expect(playlistContentIds({ id: 'x', tracks: [rawTrack] })).toEqual(['au-song-6RN8l'])
    expect(playlistContentIds(null)).toEqual([])
  })

  it('maps a playlist with curator, dates and remote art seed', () => {
    const playlist = toPlaylist(rawPlaylist)
    expect(playlist).toMatchObject({
      id: 'au-playlist-Dv9QV',
      title: 'MONKEYS CHILL',
      description: 'deep cuts',
      artworkSeed: 'https://images.audius.co/pl480.jpg',
      songIds: ['au-song-J5NMd', 'au-song-JbXXp'],
      isUserPlaylist: false,
      curator: 'SMB',
    })
    expect(playlist?.createdAt).toBe(Date.parse('2021-09-04T14:40:55Z'))
    expect(toPlaylist(null)).toBeNull()
    expect(toPlaylist({ id: 'p', playlist_name: '', title: 'Fallback' })?.title).toBe('Fallback')
  })
})
