/**
 * YouTube → domain normalisation (pure — no I/O, fully unit-testable).
 *
 * Entity ids (prefix-routed by the catalogue facade):
 *   song     yt-{videoId}          (exactly the `yt-VIDEO_ID` form)
 *   artist   yt-artist-{channelId}
 *   album    yt-album-{videoId}    single "album" per video (no albums API)
 * Playlists/channels-as-lists and channel search are out of scope for the
 * YouTube source — documented, never invented.
 *
 * YouTube `search.list` snippets return titles with HTML entities
 * (`&#39;`, `&amp;`, …) inside JSON; they are decoded here in a single
 * browser-equivalent pass (ampersand handled last by the alternation) so
 * rows never show raw entities. Songs are `playbackKind: 'youtube'` — they
 * play only through the visible official IFrame embed, never the <audio>
 * engine (`audioUrl` stays empty on purpose).
 */

import type { Album, Artist, Song } from '@/domain/types'
import type { YoutubeSearchItem, YoutubeSnippet, YoutubeVideoItem } from '@/data/youtube-client'
import { normalizeTrackLanguage } from '@/data/languages'

export const YT_SONG = 'yt-'
export const YT_ARTIST = 'yt-artist-'
export const YT_ALBUM = 'yt-album-'

/** Canonical watch URL for a video id. */
export function youtubeWatchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`
}

/** A real YouTube video id (11 URL-safe chars — documented validation rule). */
export function isYoutubeVideoId(raw: string | null | undefined): boolean {
  return typeof raw === 'string' && /^[A-Za-z0-9_-]{11}$/.test(raw)
}

/** Video id from a domain song id (`yt-VIDEO_ID`); null when not ours. */
export function youtubeVideoId(domainId: string): string | null {
  if (!domainId.startsWith(YT_SONG)) return null
  if (domainId.startsWith(YT_ARTIST) || domainId.startsWith(YT_ALBUM)) return null
  const raw = domainId.slice(YT_SONG.length)
  return raw.length > 0 ? raw : null
}

export function youtubeChannelId(domainId: string): string | null {
  if (!domainId.startsWith(YT_ARTIST)) return null
  const raw = domainId.slice(YT_ARTIST.length)
  return raw.length > 0 ? raw : null
}

export function youtubeAlbumVideoId(domainId: string): string | null {
  if (!domainId.startsWith(YT_ALBUM)) return null
  const raw = domainId.slice(YT_ALBUM.length)
  return raw.length > 0 ? raw : null
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  hellip: '…',
  ndash: '–',
  mdash: '—',
}

/** Decode HTML entities in a single left-to-right pass (browser semantics). */
export function decodeHtmlEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    const lower = entity.toLowerCase()
    if (lower.startsWith('#x')) {
      const code = Number.parseInt(entity.slice(2), 16)
      return Number.isFinite(code) ? String.fromCodePoint(code) : match
    }
    if (lower.startsWith('#')) {
      const code = Number.parseInt(entity.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : match
    }
    return NAMED_ENTITIES[lower] ?? match
  })
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? decodeHtmlEntities(value.trim()) : undefined
}

function httpUrl(value: unknown): string | undefined {
  return typeof value === 'string' && /^https?:\/\//i.test(value) ? value : undefined
}

/** Largest available thumbnail (maxres → standard → high → medium → default). */
export function bestThumbnail(snippet: YoutubeSnippet | undefined): string | undefined {
  const t = snippet?.thumbnails
  if (!t) return undefined
  return (
    httpUrl(t.maxres?.url) ??
    httpUrl(t.standard?.url) ??
    httpUrl(t.high?.url) ??
    httpUrl(t.medium?.url) ??
    httpUrl(t.default?.url)
  )
}

/** ISO 8601 duration (`PT1H2M3S`) → milliseconds; 0 when unparsable. */
export function parseIso8601Duration(value: string | undefined): number {
  if (!value) return 0
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(value)
  if (!m) return 0
  const days = Number(m[1] ?? 0)
  const hours = Number(m[2] ?? 0)
  const minutes = Number(m[3] ?? 0)
  const seconds = Number(m[4] ?? 0)
  return ((days * 24 + hours) * 3600 + minutes * 60 + seconds) * 1000
}

/**
 * Map a search result to a Song (duration filled in by the provider).
 * `opts.language` carries the `defaultAudioLanguage` collected from the
 * companion `videos.list` lookup; detail fetches fall back to the snippet.
 * Values outside the language catalogue stay absent — a track without a
 * mappable language is shown unlabelled, never mislabelled.
 */
export function toYoutubeSong(
  item: YoutubeSearchItem | undefined,
  opts: { durationMs?: number; language?: string | null } = {},
): Song | null {
  const videoId = item?.id?.videoId
  const snippet = item?.snippet
  if (!videoId || !snippet) return null
  const title = str(snippet.title)
  if (!title) return null
  const channelId = typeof snippet.channelId === 'string' ? snippet.channelId : ''
  const language = normalizeTrackLanguage(opts.language ?? snippet.defaultAudioLanguage)
  return {
    id: `${YT_SONG}${videoId}`,
    title,
    albumId: `${YT_ALBUM}${videoId}`,
    artistIds: channelId ? [`${YT_ARTIST}${channelId}`] : [],
    durationMs: opts.durationMs ?? 0,
    trackNumber: 0,
    audioUrl: '',
    source: 'youtube',
    playbackKind: 'youtube',
    artworkUrl: bestThumbnail(snippet),
    externalUrl: youtubeWatchUrl(videoId),
    ...(language ? { language, languageStatus: 'verified' as const } : {}),
  }
}

/** Map a `videos.list` item (detail page / duration fill-in). */
export function youtubeSongFromVideo(item: YoutubeVideoItem | undefined): Song | null {
  const videoId = item?.id
  if (!videoId || !item.snippet) return null
  return toYoutubeSong(
    { id: { kind: 'youtube#video', videoId }, snippet: item.snippet },
    { durationMs: parseIso8601Duration(item.contentDetails?.duration) },
  )
}

/** Channel → Artist (generated artwork seed; no avatar is invented). */
export function toYoutubeArtist(channelId: string, title: string | undefined): Artist | null {
  const name = title ? decodeHtmlEntities(title.trim()) : ''
  if (!channelId || !name) return null
  return {
    id: `${YT_ARTIST}${channelId}`,
    name,
    artworkSeed: `yt-artist-${channelId}`,
    genreIds: [],
  }
}

export function youtubeArtistFromSnippet(channelId: string, snippet: YoutubeSnippet | undefined): Artist | null {
  return toYoutubeArtist(channelId, snippet?.channelTitle)
}

/** Single-video "album" so /album and song pages resolve for YouTube songs. */
export function youtubeAlbumFromSong(song: Song | null, snippet: YoutubeSnippet | undefined): Album | null {
  if (!song) return null
  return {
    id: song.albumId,
    title: song.title,
    artistId: song.artistIds[0] ?? `${YT_ARTIST}unknown`,
    artworkSeed: song.artworkUrl ?? song.albumId,
    releaseDate: str(snippet?.publishedAt) ?? '',
    genreIds: [],
    kind: 'single',
    songIds: [song.id],
  }
}
