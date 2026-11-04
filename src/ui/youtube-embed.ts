/**
 * Visible YouTube playback — official IFrame Player API wrapper.
 *
 * The IFrame API is loaded exactly once per page (single-flight promise;
 * a failed load is cleared so a later mount can retry) through the official
 * `https://www.youtube.com/iframe_api` script, then `YT.Player` mounts into
 * a host element with default playerVars so YouTube's own controls appear
 * unaltered (the prompt's requirement: embedded playback must be visible
 * and clearly YouTube's — never backgrounded, never audio-only).
 *
 * `privacyEnhanced` mounts over a manually built
 * `https://www.youtube-nocookie.com/embed/{id}?enablejsapi=1&origin=…`
 * iframe (privacy-enhanced mode; `YT.Player` accepts an existing iframe),
 * used for made-for-kids or unknown-made-for-kids videos. The loader script
 * itself stays on youtube.com — only the playback embed changes.
 *
 * `mountYouTubeEmbed` resolves once `onReady` fires (or `null` on invalid
 * id, API-load failure, construction failure, an error before ready, or a
 * ready-timeout) so callers can render an honest fallback. Player events
 * (state changes, errors) surface through `events`.
 *
 * One embed may be live at a time: `mountYouTubeEmbed` replaces any previous
 * handle, and the shell calls `destroyYouTubeEmbed()` before rendering a new
 * route so a detached iframe can never keep playing. `loadApi` is injectable
 * so unit tests can fake the script without any network. Watch pages never
 * touch the audio engine — this is the *only* YouTube sound path.
 */

import { isYoutubeVideoId } from '@/data/youtube-normalize'

export type LoadApi = (src: string) => Promise<void>

const IFRAME_API_SRC = 'https://www.youtube.com/iframe_api'
const API_TIMEOUT_MS = 12_000
const READY_TIMEOUT_MS = 10_000
const NOCOOKIE_ORIGIN = 'https://www.youtube-nocookie.com'
const IFRAME_TITLE = 'YouTube video player'

export type YouTubePlayerState = 'unstarted' | 'ended' | 'playing' | 'paused' | 'buffering' | 'cued' | 'unknown'

export interface YouTubeEmbedEvents {
  onStateChange?: (state: YouTubePlayerState) => void
  onError?: (code: number) => void
}

interface YtPlayerLike {
  destroy(): void
  getIframe?: () => HTMLIFrameElement | null
}

interface YtNamespace {
  Player: new (target: HTMLElement | string, options: Record<string, unknown>) => YtPlayerLike
}

interface YtStateEvent {
  data?: number
}

interface YtErrorEvent {
  data?: number
}

declare global {
  interface Window {
    YT?: Partial<YtNamespace>
    onYouTubeIframeAPIReady?: () => void
  }
}

export interface YouTubeEmbedHandle {
  destroy(): void
}

export interface MountYouTubeEmbedOptions {
  host: HTMLElement
  videoId: string
  /**
   * Route-lifecycle cancellation: when aborted before the player is created,
   * the mount resolves `null` without touching the live embed — a superseded
   * /watch render can never replace the committed route's player.
   */
  signal?: AbortSignal
  /** Test seam — defaults to loading the official script. */
  loadApi?: LoadApi
  /**
   * Privacy-enhanced (youtube-nocookie.com) playback. Required for
   * made-for-kids videos and the conservative choice when the made-for-kids
   * status is unknown (Developer Policies III.E.4.j).
   */
  privacyEnhanced?: boolean
  events?: YouTubeEmbedEvents
  /** Ready-gate timeout; resolving `null` renders the external-link fallback. */
  readyTimeoutMs?: number
}

let apiPromise: Promise<void> | null = null
let activeEmbed: YouTubeEmbedHandle | null = null

/** Test hook: forget the cached single-flight load. */
export function resetYoutubeIframeApiForTests(): void {
  apiPromise = null
}

function defaultLoadApi(src: string): Promise<void> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return Promise.reject(new Error('No DOM available for the YouTube iframe API'))
  }
  if (window.YT?.Player) return Promise.resolve()
  return new Promise<void>((resolve, reject) => {
    let settled = false
    const prev = window.onYouTubeIframeAPIReady
    const finish = (): void => {
      settled = true
      window.clearTimeout(timer)
      window.onYouTubeIframeAPIReady = prev
    }
    const timer = window.setTimeout(() => {
      if (settled) return
      finish()
      reject(new Error('Timed out loading the YouTube iframe API'))
    }, API_TIMEOUT_MS)
    window.onYouTubeIframeAPIReady = () => {
      if (settled) return
      finish()
      prev?.()
      resolve()
    }
    if (document.querySelector(`script[src="${src}"]`)) return // callback still pending
    const script = document.createElement('script')
    script.src = src
    script.async = true
    script.onerror = () => {
      if (settled) return
      finish()
      reject(new Error('Failed to load the YouTube iframe API'))
    }
    document.head.appendChild(script)
  })
}

/**
 * Load the IFrame API once. Repeated calls share one promise; a rejected
 * load clears it so the next call retries. Resolves immediately when a
 * `YT.Player` factory already exists.
 */
export function loadYoutubeIframeApi(loadApi: LoadApi = defaultLoadApi): Promise<void> {
  if (typeof window !== 'undefined' && window.YT?.Player) return Promise.resolve()
  if (!apiPromise) {
    apiPromise = loadApi(IFRAME_API_SRC).catch((err: unknown) => {
      apiPromise = null
      throw err
    })
  }
  return apiPromise
}

/** Destroy the live embed, if any (shell calls this on route renders). */
export function destroyYouTubeEmbed(): void {
  activeEmbed?.destroy()
  activeEmbed = null
}

/** YT onStateChange numbers → names (docs: IFrame Player API states). */
function stateFromData(data: number | undefined): YouTubePlayerState {
  switch (data) {
    case 0:
      return 'ended'
    case 1:
      return 'playing'
    case 2:
      return 'paused'
    case 3:
      return 'buffering'
    case 5:
      return 'cued'
    case -1:
      return 'unstarted'
    default:
      return 'unknown'
  }
}

/** Privacy-enhanced iframe built by hand (no JS until the API attaches). */
function buildNocookieIframe(videoId: string): HTMLIFrameElement {
  const iframe = document.createElement('iframe')
  const params = new URLSearchParams({ enablejsapi: '1', origin: window.location.origin })
  iframe.src = `${NOCOOKIE_ORIGIN}/embed/${videoId}?${params.toString()}`
  iframe.title = IFRAME_TITLE
  iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share'
  iframe.allowFullscreen = true
  iframe.style.border = '0'
  iframe.style.width = '100%'
  iframe.style.height = '100%'
  return iframe
}

/**
 * Mount a default-controls embed for `videoId` into `host`.
 * Resolves the handle once the player is ready; resolves `null` when the id
 * is invalid, the API cannot load, the player errors or never becomes ready —
 * callers render the “Watch on YouTube” fallback in that case.
 */
export async function mountYouTubeEmbed(opts: MountYouTubeEmbedOptions): Promise<YouTubeEmbedHandle | null> {
  const { host, videoId } = opts
  if (!isYoutubeVideoId(videoId)) return null
  if (opts.signal?.aborted) return null
  try {
    await loadYoutubeIframeApi(opts.loadApi ?? defaultLoadApi)
  } catch {
    return null
  }
  // Superseded while the API loaded (route changed): never mount, never
  // replace the live embed.
  if (opts.signal?.aborted) return null
  const YT = window.YT as Partial<YtNamespace> | undefined
  if (!YT?.Player) return null
  const Player = YT.Player

  destroyYouTubeEmbed()
  host.innerHTML = ''

  const target: HTMLElement = opts.privacyEnhanced
    ? buildNocookieIframe(videoId)
    : document.createElement('div')
  if (!opts.privacyEnhanced) target.setAttribute('data-yt-mount', '')
  host.appendChild(target)

  let player: YtPlayerLike | null = null
  let destroyed = false
  let settled = false
  let failed = false
  let resolveOuter: (handle: YouTubeEmbedHandle | null) => void = () => {}
  const done = (handle: YouTubeEmbedHandle | null): void => {
    if (settled) return
    settled = true
    window.clearTimeout(readyTimer)
    resolveOuter(handle)
  }

  /** Failed before/at ready: tear the half-built player down, resolve null. */
  const fail = (): void => {
    failed = true
    if (player) {
      try {
        player.destroy()
      } catch {
        /* already gone */
      }
      player = null
    }
    host.innerHTML = ''
    done(null)
  }

  const handle: YouTubeEmbedHandle = {
    destroy(): void {
      if (destroyed) return
      destroyed = true
      if (player) {
        try {
          player.destroy()
        } catch {
          /* already gone */
        }
        player = null
      }
      host.innerHTML = ''
      // A destroy while still mounting (route change) resolves the pending
      // promise as a failed mount so callers never touch a dead handle.
      done(null)
    },
  }

  const readyTimer = window.setTimeout(() => {
    if (destroyed || settled) return
    fail()
  }, opts.readyTimeoutMs ?? READY_TIMEOUT_MS)

  const events: Record<string, unknown> = {
    onReady: (): void => {
      if (destroyed || settled) return
      try {
        player?.getIframe?.()?.setAttribute('title', IFRAME_TITLE)
      } catch {
        /* title is a progressive enhancement */
      }
      activeEmbed = handle
      done(handle)
    },
    onStateChange: (e: YtStateEvent): void => {
      if (destroyed) return
      opts.events?.onStateChange?.(stateFromData(e?.data))
    },
    onError: (e: YtErrorEvent): void => {
      if (destroyed) return
      const code = typeof e?.data === 'number' ? e.data : -1
      if (!settled) {
        // Error before ready (invalid id, embed disabled) → failed mount.
        fail()
        return
      }
      opts.events?.onError?.(code)
    },
  }

  return new Promise<YouTubeEmbedHandle | null>((resolve) => {
    resolveOuter = resolve
    try {
      player = new Player(target, { videoId, width: '100%', height: '100%', events })
    } catch {
      fail()
      return
    }
    if (failed && player) {
      // An error fired synchronously during construction (before `player`
      // was assigned) — fail() could not tear it down then; do it now.
      try {
        player.destroy()
      } catch {
        /* already gone */
      }
      player = null
      host.innerHTML = ''
      return
    }
    if (destroyed) return // destroy raced construction
  })
}
