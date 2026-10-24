import { describe, expect, it } from 'vitest'
import type { YoutubeSearchItem, YoutubeVideoItem } from '@/data/youtube-client'
import {
  YT_ALBUM,
  YT_ARTIST,
  YT_SONG,
  bestThumbnail,
  decodeHtmlEntities,
  isYoutubeVideoId,
  parseIso8601Duration,
  toYoutubeArtist,
  toYoutubeSong,
  youtubeAlbumFromSong,
  youtubeAlbumVideoId,
  youtubeChannelId,
  youtubeSongFromVideo,
  youtubeVideoId,
  youtubeWatchUrl,
} from '@/data/youtube-normalize'

describe('YouTube id routing', () => {
  it('splits song / artist / album ids by prefix and never confuses them', () => {
    expect(YT_SONG).toBe('yt-')
    expect(YT_ARTIST).toBe('yt-artist-')
    expect(YT_ALBUM).toBe('yt-album-')

    expect(youtubeVideoId('yt-dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
    expect(youtubeVideoId('yt-artist-UCx')).toBeNull()
    expect(youtubeVideoId('yt-album-dQw4w9WgXcQ')).toBeNull()
    expect(youtubeVideoId('s-mg-1')).toBeNull()
    expect(youtubeVideoId('yt-')).toBeNull()

    expect(youtubeChannelId('yt-artist-UCx')).toBe('UCx')
    expect(youtubeChannelId('yt-dQw4w9WgXcQ')).toBeNull()
    expect(youtubeChannelId('yt-album-x')).toBeNull()

    expect(youtubeAlbumVideoId('yt-album-dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
    expect(youtubeAlbumVideoId('yt-dQw4w9WgXcQ')).toBeNull()
    expect(youtubeAlbumVideoId('yt-artist-UCx')).toBeNull()
  })

  it('validates real 11-char video ids for the embed path', () => {
    expect(isYoutubeVideoId('dQw4w9WgXcQ')).toBe(true)
    expect(isYoutubeVideoId('too-short')).toBe(false)
    expect(isYoutubeVideoId('has spaces!!')).toBe(false)
    expect(isYoutubeVideoId('')).toBe(false)
    expect(isYoutubeVideoId(undefined)).toBe(false)
    expect(isYoutubeVideoId(null)).toBe(false)
  })

  it('builds the canonical watch URL', () => {
    expect(youtubeWatchUrl('dQw4w9WgXcQ')).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
  })
})

describe('decodeHtmlEntities', () => {
  it('decodes numeric, hex and named entities in one pass (browser semantics)', () => {
    expect(decodeHtmlEntities('Rock &#39;n&#39; Roll')).toBe("Rock 'n' Roll")
    expect(decodeHtmlEntities('a &#x27; b')).toBe("a ' b")
    expect(decodeHtmlEntities('Q&amp;A &lt;ok&gt;')).toBe('Q&A <ok>')
    expect(decodeHtmlEntities('it&#39;s &amp; more')).toBe("it's & more") // & last: no double decode
    expect(decodeHtmlEntities('&hellip; &mdash;')).toBe('… —')
    expect(decodeHtmlEntities('&nbsp;')).toBe(' ')
    expect(decodeHtmlEntities('&unknown; stays')).toBe('&unknown; stays')
  })
})

describe('bestThumbnail', () => {
  const thumb = (url: string): { thumbnails?: Record<string, { url: string }> } => ({
    thumbnails: { medium: { url } },
  })

  it('prefers the largest valid thumbnail (maxres → standard → high → medium → default)', () => {
    expect(
      bestThumbnail({
        thumbnails: {
          default: { url: 'https://img/d.jpg' },
          medium: { url: 'https://img/m.jpg' },
          maxres: { url: 'https://img/x.jpg' },
        },
      }),
    ).toBe('https://img/x.jpg')
    expect(bestThumbnail(thumb('https://img/m.jpg'))).toBe('https://img/m.jpg')
    expect(bestThumbnail(undefined)).toBeUndefined()
    expect(bestThumbnail({})).toBeUndefined()
  })

  it('rejects non-http(s) thumbnail URLs', () => {
    expect(bestThumbnail(thumb('javascript:alert(1)'))).toBeUndefined()
    expect(bestThumbnail(thumb('data:image/png;base64,xxx'))).toBeUndefined()
  })
})

describe('parseIso8601Duration', () => {
  it('parses documented ISO 8601 forms to milliseconds', () => {
    expect(parseIso8601Duration('PT3M33S')).toBe(213_000)
    expect(parseIso8601Duration('PT1H2M3S')).toBe(3_723_000)
    expect(parseIso8601Duration('PT45S')).toBe(45_000)
    expect(parseIso8601Duration('PT1H')).toBe(3_600_000)
    expect(parseIso8601Duration('P1DT2H')).toBe(93_600_000)
    expect(parseIso8601Duration('P0D')).toBe(0)
  })

  it('returns 0 for missing or unparsable values', () => {
    expect(parseIso8601Duration(undefined)).toBe(0)
    expect(parseIso8601Duration('')).toBe(0)
    expect(parseIso8601Duration('nonsense')).toBe(0)
  })
})

describe('toYoutubeSong / youtubeSongFromVideo', () => {
  const searchItem: YoutubeSearchItem = {
    id: { kind: 'youtube#video', videoId: 'dQw4w9WgXcQ' },
    snippet: {
      title: 'Rock &#39;n&#39; Roll',
      channelId: 'UCxyz',
      channelTitle: 'Ada &amp; Co',
      thumbnails: { medium: { url: 'https://i.ytimg.com/vi/x/mq.jpg' } },
    },
  }

  it('maps a search item to a non-audio YouTube song (entities decoded)', () => {
    const song = toYoutubeSong(searchItem, { durationMs: 213_000 })
    expect(song).toMatchObject({
      id: 'yt-dQw4w9WgXcQ',
      title: "Rock 'n' Roll",
      albumId: 'yt-album-dQw4w9WgXcQ',
      artistIds: ['yt-artist-UCxyz'],
      durationMs: 213_000,
      audioUrl: '',
      source: 'youtube',
      playbackKind: 'youtube',
      artworkUrl: 'https://i.ytimg.com/vi/x/mq.jpg',
      externalUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    })
  })

  it('returns null for items without a video id or title', () => {
    expect(toYoutubeSong(undefined)).toBeNull()
    expect(toYoutubeSong({ snippet: searchItem.snippet })).toBeNull()
    expect(toYoutubeSong({ id: { videoId: 'dQw4w9WgXcQ' } })).toBeNull()
    expect(toYoutubeSong({ id: { videoId: 'dQw4w9WgXcQ' }, snippet: {} })).toBeNull()
  })

  it('fills duration from videos.list detail', () => {
    const video: YoutubeVideoItem = {
      id: 'dQw4w9WgXcQ',
      snippet: searchItem.snippet,
      contentDetails: { duration: 'PT3M33S' },
    }
    expect(youtubeSongFromVideo(video)?.durationMs).toBe(213_000)
    expect(youtubeSongFromVideo(undefined)).toBeNull()
    expect(youtubeSongFromVideo({ id: 'dQw4w9WgXcQ' })).toBeNull()
  })
})

describe('channel and single-video album helpers', () => {
  it('maps channels to artists, refusing empty names', () => {
    expect(toYoutubeArtist('UCx', ' Ada Sessions ')).toEqual({
      id: 'yt-artist-UCx',
      name: 'Ada Sessions',
      artworkSeed: 'yt-artist-UCx',
      genreIds: [],
    })
    expect(toYoutubeArtist('UCx', '   ')).toBeNull()
    expect(toYoutubeArtist('', 'Ada')).toBeNull()
  })

  it('builds one album per video with its own release date', () => {
    const song = toYoutubeSong({
      id: { videoId: 'dQw4w9WgXcQ' },
      snippet: { title: 'Harbor', channelId: 'UCx', channelTitle: 'Ada' },
    })
    const album = youtubeAlbumFromSong(song, { publishedAt: '2024-05-01T12:00:00Z' })
    expect(album).toMatchObject({
      id: 'yt-album-dQw4w9WgXcQ',
      title: 'Harbor',
      artistId: 'yt-artist-UCx',
      releaseDate: '2024-05-01T12:00:00Z',
      songIds: ['yt-dQw4w9WgXcQ'],
      kind: 'single',
    })
    expect(youtubeAlbumFromSong(null, {})).toBeNull()
  })
})
