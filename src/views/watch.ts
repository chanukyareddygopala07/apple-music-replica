/**
 * Watch view — visible, official YouTube embed for `playbackKind: 'youtube'`
 * songs (route `/watch/:id` with a `yt-{videoId}` id).
 *
 * Navigating here pauses the audio engine so two sound sources can never
 * overlap; leaving the page destroys the embed (the shell calls
 * `destroyYouTubeEmbed()` before every route render). Metadata (title,
 * byline) is a best-effort detail lookup and is skipped entirely when no
 * API key is configured — a keyless build sends zero Data API requests and
 * still plays via the official iframe (privacy-enhanced / nocookie embed
 * whenever the made-for-kids status is not confirmed false), falling back
 * to the external watch link only when the embed cannot mount or errors.
 *
 * The player never autoplays (user must press play), and a status line
 * (aria-live) reports Ready / Playing / Paused / Buffering / Ended.
 */

import type { Song } from '@/domain/types'
import { catalog, youtubeMadeForKids } from '@/data/catalog'
import { artistNamesFor } from '@/data/catalog-helpers'
import { isYoutubeConfigured } from '@/data/youtube-config'
import { player } from '@/engine/player'
import { withBase } from '@/app/router'
import { escapeHtml, on, qs } from '@/ui/el'
import { emptyStateHtml } from '@/ui/media'
import { mountYouTubeEmbed, type YouTubeEmbedHandle, type YouTubePlayerState } from '@/ui/youtube-embed'
import { youtubeVideoId, youtubeWatchUrl } from '@/data/youtube-normalize'

const STATE_STATUS: Record<'playing' | 'paused' | 'buffering' | 'ended', string> = {
  playing: 'Playing',
  paused: 'Paused',
  buffering: 'Buffering',
  ended: 'Ended',
}

export async function renderWatch(root: HTMLElement, id: string): Promise<void> {
  player.pause()

  root.innerHTML = `
    <div class="watch-head" style="padding:24px 40px 8px">
      <button type="button" class="btn btn-secondary" data-action="watch-back" aria-label="Go back">Back</button>
      <h1 class="page-title" style="margin-top:12px">YouTube</h1>
      <div class="watch-sub" id="watch-sub" style="opacity:.7">Loading…</div>
    </div>
    <div class="watch-stage" id="yt-watch-host" style="max-width:960px;margin:16px 40px 0;border-radius:12px;overflow:hidden;background:#000;aspect-ratio:16/9;min-height:200px;display:flex;align-items:center;justify-content:center">
      <span style="color:#999;font-size:14px">Loading player…</span>
    </div>
    <div id="watch-status" role="status" aria-live="polite" style="margin:8px 40px 0;font-size:13px;opacity:.7">Loading player…</div>
    <div id="watch-foot" style="margin:12px 40px 40px;opacity:.7;font-size:13px">Playback is provided by YouTube in an official embedded player (press play to start — never autoplayed). <a href="https://www.youtube.com/t/terms" target="_blank" rel="noopener noreferrer">YouTube Terms of Service</a></div>`

  on(root, 'click', '[data-action="watch-back"]', () => {
    if (window.history.length > 1) window.history.back()
    else window.location.href = withBase('/search')
  })

  const host = qs<HTMLElement>('#yt-watch-host', root)
  const sub = qs<HTMLElement>('#watch-sub', root)
  const status = qs<HTMLElement>('#watch-status', root)
  if (!host || !sub) return

  const videoId = youtubeVideoId(id)
  if (!videoId) {
    host.style.background = 'transparent'
    host.style.aspectRatio = 'auto'
    host.style.minHeight = '0'
    host.innerHTML = emptyStateHtml('alert', 'Invalid video', 'This link does not point at a YouTube video.')
    sub.textContent = ''
    if (status) status.textContent = ''
    return
  }

  const setStatus = (text: string): void => {
    if (status) status.textContent = text
  }

  // Metadata is a nice-to-have: with no key configured, skip the lookup so a
  // keyless build performs zero YouTube Data API requests on /watch.
  let song: Song | null = null
  if (isYoutubeConfigured()) {
    try {
      song = await catalog.getSong(id)
    } catch {
      song = null
    }
  }
  if (!host.isConnected) return // navigated away while resolving metadata
  sub.innerHTML = song
    ? `${escapeHtml(song.title)} · ${escapeHtml(artistNamesFor(song))} · <span class="watch-by">YouTube</span>`
    : 'YouTube video'

  // Made-for-kids lookup result (undefined = unknown): only a confirmed
  // `false` allows the standard embed — true or unknown uses privacy-
  // enhanced (nocookie) embedding (Developer Policies III.E.4.j).
  const privacyEnhanced = youtubeMadeForKids(id) !== false

  const renderFallback = (): void => {
    host.style.background = 'transparent'
    host.style.aspectRatio = 'auto'
    host.style.minHeight = '120px'
    host.innerHTML = emptyStateHtml(
      'play',
      'Player unavailable',
      'The embedded player could not start. Open the video on YouTube instead.',
      `<a class="btn btn-primary" href="${escapeHtml(youtubeWatchUrl(videoId))}" target="_blank" rel="noopener noreferrer">Watch on YouTube</a>`,
    )
  }

  let mounted: YouTubeEmbedHandle | null = null
  const handle = await mountYouTubeEmbed({
    host,
    videoId,
    privacyEnhanced,
    events: {
      onStateChange: (state: YouTubePlayerState) => {
        const label = STATE_STATUS[state as keyof typeof STATE_STATUS]
        if (label) setStatus(label)
      },
      onError: (code: number) => {
        // Errors after ready (e.g. 100/101/150 embed restrictions): stop the
        // broken player and offer the external link instead.
        mounted?.destroy()
        mounted = null
        if (host.isConnected) renderFallback()
        setStatus(code > 0 ? `Playback error (${code}) — open the video on YouTube instead.` : 'Playback error — open the video on YouTube instead.')
      },
    },
  })
  mounted = handle
  if (!host.isConnected) {
    handle?.destroy()
    return
  }
  if (!handle) {
    renderFallback()
    setStatus('Player unavailable — open the video on YouTube instead.')
    return
  }
  setStatus('Ready — press play to watch.')
}
