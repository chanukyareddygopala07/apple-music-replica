import { describe, expect, it } from 'vitest'
import type { JamendoRawTrack } from '@/data/jamendo-client'
import {
  JM_ALBUM,
  JM_ALBUM_SINGLE,
  JM_ARTIST,
  JM_SONG,
  albumFromTrack,
  jamendoRawId,
  singleAlbumFromTrack,
  toJamendoAlbum,
  toJamendoArtist,
  toJamendoArtistFromRaw,
  toJamendoSong,
} from '@/data/jamendo-normalize'

/** Shape of the documented tracks response (developer.jamendo.com/v3.0/tracks). */
function rawTrack(extra: Partial<JamendoRawTrack> = {}): JamendoRawTrack {
  return {
    id: '1848357',
    name: 'mañana será tarde',
    duration: 272,
    artist_id: '421168',
    artist_name: 'fankel',
    album_id: '368084',
    album_name: 'mañana será tarde',
    album_image: 'https://usercontent.jamendo.com?type=album&id=368084',
    image: 'https://usercontent.jamendo.com?type=album&id=368084',
    audio: 'https://prod-1.storage.jamendo.com/?trackid=1848357&format=mp32',
    audiodownload: 'https://prod-1.storage.jamendo.com/download/track/1848357/mp32/',
    audiodownload_allowed: true,
    license_ccurl: 'http://creativecommons.org/licenses/by-nc-nd/3.0/',
    releasedate: '2021-04-11',
    shareurl: 'https://www.jamendo.com/track/1848357',
    shorturl: 'https://jamen.do/t/1848357',
    position: 1,
    ...extra,
  }
}

describe('toJamendoSong (normalisation)', () => {
  it('maps a full documented track onto the domain model', () => {
    const song = toJamendoSong(rawTrack())
    expect(song).toMatchObject({
      id: `${JM_SONG}1848357`,
      title: 'mañana será tarde',
      albumId: `${JM_ALBUM}368084`,
      artistIds: [`${JM_ARTIST}421168`],
      durationMs: 272_000,
      trackNumber: 1,
      audioUrl: 'https://prod-1.storage.jamendo.com/?trackid=1848357&format=mp32',
      source: 'jamendo',
      playbackKind: 'audio',
      artworkUrl: 'https://usercontent.jamendo.com?type=album&id=368084',
      externalUrl: 'https://www.jamendo.com/track/1848357',
      attribution: 'Jamendo',
      attributionUrl: 'http://creativecommons.org/licenses/by-nc-nd/3.0/',
    })
  })

  it('synthesises jm-album-t-* album ids for singles with no album', () => {
    const song = toJamendoSong(rawTrack({ album_id: undefined, album_name: undefined, album_image: undefined }))
    expect(song?.albumId).toBe(`${JM_ALBUM_SINGLE}1848357`)
  })

  it('drops tracks without a playable stream, id, or title', () => {
    expect(toJamendoSong(rawTrack({ audio: undefined }))).toBeNull()
    expect(toJamendoSong(rawTrack({ audio: '' }))).toBeNull()
    expect(toJamendoSong(rawTrack({ id: undefined }))).toBeNull()
    expect(toJamendoSong(rawTrack({ name: '  ' }))).toBeNull()
    expect(toJamendoSong(null)).toBeNull()
    expect(toJamendoSong(undefined)).toBeNull()
  })

  it('keeps a song playable-but-artistless without broken artist links', () => {
    const song = toJamendoSong(rawTrack({ artist_id: undefined, artist_name: undefined }))
    expect(song?.artistIds).toEqual([])
    expect(toJamendoArtist(rawTrack({ artist_id: undefined }))).toBeNull()
  })

  it('leaves artworkUrl undefined when the track carries no image URL', () => {
    const song = toJamendoSong(rawTrack({ image: undefined, album_image: undefined }))
    expect(song?.artworkUrl).toBeUndefined()
    expect(song?.id).toBe(`${JM_SONG}1848357`) // still routable
  })

  it('rejects non-http artwork/licence/share URLs instead of emitting them', () => {
    const song = toJamendoSong(
      rawTrack({
        image: 'javascript:alert(1)',
        license_ccurl: 'data:text/html,hi',
        shareurl: '/track/1848357',
      }),
    )
    expect(song?.artworkUrl).toBeUndefined()
    expect(song?.attributionUrl).toBeUndefined()
    expect(song?.externalUrl).toBeUndefined()
    expect(song?.attribution).toBe('Jamendo') // source label survives
  })

  it('parses documented duration/position numbers and their string forms', () => {
    expect(toJamendoSong(rawTrack({ duration: 181 }))?.durationMs).toBe(181_000)
    expect(toJamendoSong(rawTrack({ duration: '90' as unknown as number }))?.durationMs).toBe(90_000)
    expect(toJamendoSong(rawTrack({ duration: Number.NaN }))?.durationMs).toBe(0)
    expect(toJamendoSong(rawTrack({ position: 3 }))?.trackNumber).toBe(3)
    expect(toJamendoSong(rawTrack({ position: undefined }))?.trackNumber).toBe(0)
  })

  it('never routes through the download URL (streaming only)', () => {
    const song = toJamendoSong(rawTrack())
    expect(song?.audioUrl).not.toContain('download')
    expect(song?.audioUrl).toContain('prod-1.storage.jamendo.com')
  })
})

describe('toJamendoSong language metadata (musicinfo.lang)', () => {
  it('adopts a stated ISO 639-1 lyrics language as verified', () => {
    const song = toJamendoSong(rawTrack({ musicinfo: { lang: 'fr' } }))
    expect(song?.language).toBe('fr')
    expect(song?.languageStatus).toBe('verified')
  })

  it('normalises case and trims', () => {
    expect(toJamendoSong(rawTrack({ musicinfo: { lang: ' EN ' } }))?.language).toBe('en')
  })

  it('stays unknown for absent, empty or unrecognised values (eligible everywhere)', () => {
    for (const musicinfo of [undefined, { lang: '' }, { lang: 'English' }, { lang: 'frx' }, { lang: '12' }]) {
      const song = toJamendoSong(rawTrack({ musicinfo }))
      expect(song?.language).toBeUndefined()
      expect(song?.languageStatus).toBeUndefined()
    }
  })
})

describe('album and artist mapping', () => {
  it('builds an album entity from an album-track row', () => {
    const album = albumFromTrack(rawTrack())
    expect(album).toMatchObject({
      id: `${JM_ALBUM}368084`,
      title: 'mañana será tarde',
      artistId: `${JM_ARTIST}421168`,
      releaseDate: '2021-04-11',
      kind: 'album',
      songIds: [],
    })
  })

  it('returns null for a single row (no album exists to show)', () => {
    expect(albumFromTrack(rawTrack({ album_id: undefined }))).toBeNull()
    expect(albumFromTrack(null)).toBeNull()
  })

  it('never emits an empty artist id when the album artist is missing', () => {
    const album = albumFromTrack(rawTrack({ artist_id: undefined }))
    expect(album?.artistId).toBe(`${JM_ARTIST}unknown`)
    expect(toJamendoAlbum({ id: '9', name: 'Loose Ends' })?.artistId).toBe(`${JM_ARTIST}unknown`)
  })

  it('synthesises a single-track album for singles', () => {
    const album = singleAlbumFromTrack(rawTrack({ album_id: undefined, album_image: undefined }))
    expect(album).toMatchObject({
      id: `${JM_ALBUM_SINGLE}1848357`,
      kind: 'single',
      songIds: [`${JM_SONG}1848357`],
      artworkSeed: 'https://usercontent.jamendo.com?type=album&id=368084', // image, not album_image
    })
    expect(singleAlbumFromTrack(rawTrack({ id: undefined }))).toBeNull()
    expect(singleAlbumFromTrack(rawTrack({ name: '' }))).toBeNull()
  })

  it('maps album and artist endpoints, dropping rows without ids/names', () => {
    expect(toJamendoAlbum({ id: '368084', name: 'Sunrise', artist_id: '421168' })).toMatchObject({
      id: `${JM_ALBUM}368084`,
      artistId: `${JM_ARTIST}421168`,
      kind: 'album',
    })
    expect(toJamendoAlbum({ id: '368084' })).toBeNull()
    expect(toJamendoAlbum(null)).toBeNull()
    expect(toJamendoArtistFromRaw({ id: '421168', name: 'fankel' })).toMatchObject({
      id: `${JM_ARTIST}421168`,
      name: 'fankel',
    })
    expect(toJamendoArtistFromRaw({ name: 'no id' })).toBeNull()
    expect(toJamendoArtistFromRaw(null)).toBeNull()
  })
})

describe('jamendoRawId', () => {
  it('unwraps only its own prefix', () => {
    expect(jamendoRawId(`${JM_SONG}1848357`, JM_SONG)).toBe('1848357')
    expect(jamendoRawId('au-song-1', JM_SONG)).toBeNull()
    expect(jamendoRawId(JM_SONG, JM_SONG)).toBeNull()
    expect(jamendoRawId('', JM_SONG)).toBeNull()
  })
})
