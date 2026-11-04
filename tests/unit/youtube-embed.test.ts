import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  destroyYouTubeEmbed,
  loadYoutubeIframeApi,
  mountYouTubeEmbed,
  resetYoutubeIframeApiForTests,
} from '@/ui/youtube-embed'

interface FakeEvents {
  onReady?: () => void
  onStateChange?: (e: { data?: number }) => void
  onError?: (e: { data?: number }) => void
}

/** What the fake YT.Player does when constructed. */
type Behavior = 'ready' | 'silent' | 'error'

let behavior: Behavior = 'ready'
let lastEvents: FakeEvents = {}
let lastOpts: Record<string, unknown> = {}
let lastTarget: HTMLElement | null = null
let lastVideoId: string | undefined
let destroyCalls = 0

class FakePlayer {
  private readonly target: HTMLElement | string

  constructor(target: HTMLElement | string, opts: Record<string, unknown>) {
    this.target = target
    lastTarget = typeof target === 'string' ? null : target
    lastOpts = opts
    lastVideoId = opts.videoId as string | undefined
    lastEvents = (opts.events ?? {}) as FakeEvents
    if (behavior === 'ready') lastEvents.onReady?.()
    if (behavior === 'error') lastEvents.onError?.({ data: 100 })
  }

  destroy(): void {
    destroyCalls += 1
  }

  getIframe(): HTMLIFrameElement | null {
    return this.target instanceof HTMLIFrameElement ? this.target : null
  }
}

function setFakeYT(): void {
  window.YT = {
    Player: FakePlayer as unknown as new (t: string | HTMLElement, o: Record<string, unknown>) => never,
  }
}

function hostEl(): HTMLElement {
  const host = document.createElement('div')
  document.body.appendChild(host)
  return host
}

beforeEach(() => {
  behavior = 'ready'
  lastEvents = {}
  lastTarget = null
  lastVideoId = undefined
  destroyCalls = 0
  delete window.YT
  delete window.onYouTubeIframeAPIReady
  resetYoutubeIframeApiForTests()
  destroyYouTubeEmbed()
  document.body.innerHTML = ''
})

afterEach(() => {
  destroyYouTubeEmbed()
  delete window.YT
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('mountYouTubeEmbed', () => {
  it('rejects an invalid video id without ever loading the API', async () => {
    const loadApi = vi.fn().mockResolvedValue(undefined)
    const host = hostEl()
    await expect(mountYouTubeEmbed({ host, videoId: 'not-valid', loadApi })).resolves.toBeNull()
    expect(loadApi).not.toHaveBeenCalled()
    expect(host.innerHTML).toBe('')
  })

  it('returns null when the IFrame API fails to load', async () => {
    const loadApi = vi.fn().mockRejectedValue(new Error('blocked'))
    const host = hostEl()
    await expect(mountYouTubeEmbed({ host, videoId: 'dQw4w9WgXcQ', loadApi })).resolves.toBeNull()
    expect(loadApi).toHaveBeenCalledWith('https://www.youtube.com/iframe_api')
    expect(host.innerHTML).toBe('')
  })

  it('mounts a default-controls player and resolves once ready', async () => {
    setFakeYT()
    const host = hostEl()
    const handle = await mountYouTubeEmbed({ host, videoId: 'dQw4w9WgXcQ' })
    expect(handle).not.toBeNull()
    expect(lastVideoId).toBe('dQw4w9WgXcQ')
    expect(lastTarget?.getAttribute('data-yt-mount')).not.toBeNull() // standard (non-nocookie) mount
    expect(lastTarget?.parentElement).toBe(host)

    handle!.destroy()
    expect(host.innerHTML).toBe('')
    expect(destroyCalls).toBe(1)
  })

  it('surfaces player state changes and post-ready errors through events', async () => {
    setFakeYT()
    const host = hostEl()
    const onStateChange = vi.fn()
    const onError = vi.fn()
    await mountYouTubeEmbed({ host, videoId: 'dQw4w9WgXcQ', events: { onStateChange, onError } })

    for (const [data, label] of [
      [1, 'playing'],
      [2, 'paused'],
      [3, 'buffering'],
      [0, 'ended'],
      [5, 'cued'],
      [-1, 'unstarted'],
      [99, 'unknown'],
    ] as const) {
      lastEvents.onStateChange?.({ data })
      expect(onStateChange).toHaveBeenLastCalledWith(label)
    }

    lastEvents.onError?.({ data: 101 }) // after ready → surfaced, not fatal
    expect(onError).toHaveBeenCalledWith(101)
  })

  it('resolves null when the player errors before ready (half-built player torn down)', async () => {
    behavior = 'error'
    setFakeYT()
    const host = hostEl()
    await expect(mountYouTubeEmbed({ host, videoId: 'dQw4w9WgXcQ' })).resolves.toBeNull()
    expect(destroyCalls).toBe(1) // fail() destroys the player
    expect(host.innerHTML).toBe('')
  })

  it('resolves null when the player never becomes ready (ready timeout)', async () => {
    behavior = 'silent'
    setFakeYT()
    const host = hostEl()
    await expect(mountYouTubeEmbed({ host, videoId: 'dQw4w9WgXcQ', readyTimeoutMs: 10 })).resolves.toBeNull()
    expect(destroyCalls).toBe(1)
    expect(host.innerHTML).toBe('')
  })

  it('resolves null without mounting when the signal aborts during API load (superseded route)', async () => {
    // No fake YT yet — the point is the API is still "loading".
    const host = hostEl()
    const controller = new AbortController()
    let releaseLoad!: () => void
    const loadApi = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          releaseLoad = () => resolve()
        }),
    )
    const pending = mountYouTubeEmbed({ host, videoId: 'dQw4w9WgXcQ', loadApi, signal: controller.signal })
    // Let the mount reach the loadApi await, then supersede the route.
    await Promise.resolve()
    controller.abort()
    releaseLoad()
    // Even if YT appears after the load resolves, the abort short-circuits.
    setFakeYT()
    await expect(pending).resolves.toBeNull()
    expect(lastTarget).toBeNull() // Player never constructed
    expect(host.innerHTML).toBe('')
  })

  it('an already-aborted signal short-circuits before the API loads', async () => {
    setFakeYT()
    const host = hostEl()
    const controller = new AbortController()
    controller.abort()
    const loadApi = vi.fn().mockResolvedValue(undefined)
    await expect(
      mountYouTubeEmbed({ host, videoId: 'dQw4w9WgXcQ', loadApi, signal: controller.signal }),
    ).resolves.toBeNull()
    expect(loadApi).not.toHaveBeenCalled()
    expect(host.innerHTML).toBe('')
  })

  it('privacy-enhanced mode mounts a nocookie iframe with enablejsapi + origin', async () => {
    setFakeYT()
    const host = hostEl()
    const handle = await mountYouTubeEmbed({ host, videoId: 'dQw4w9WgXcQ', privacyEnhanced: true })
    expect(handle).not.toBeNull()

    const iframe = lastTarget as HTMLIFrameElement | null
    expect(iframe?.tagName).toBe('IFRAME')
    const src = new URL(iframe!.src)
    expect(src.origin).toBe('https://www.youtube-nocookie.com')
    expect(src.pathname).toBe('/embed/dQw4w9WgXcQ')
    expect(src.searchParams.get('enablejsapi')).toBe('1')
    expect(src.searchParams.get('origin')).toBe(window.location.origin)
    expect(iframe!.title).toBe('YouTube video player') // set on ready via getIframe()
    expect(host.querySelector('[data-yt-mount]')).toBeNull()
  })

  it('never autoplays and passes no playerVars (YouTube defaults only)', async () => {
    setFakeYT()
    const host = hostEl()
    await mountYouTubeEmbed({ host, videoId: 'dQw4w9WgXcQ' })
    expect(lastOpts.playerVars).toBeUndefined() // defaults → YouTube's own controls, no autoplay
    expect(JSON.stringify(lastOpts)).not.toContain('autoplay')
    expect(lastOpts.videoId).toBe('dQw4w9WgXcQ')
    expect(lastOpts.width).toBe('100%')
    expect(lastOpts.height).toBe('100%')
  })
})

describe('embed lifecycle', () => {
  it('only one embed is live: a new mount replaces the previous handle', async () => {
    setFakeYT()
    const hostA = hostEl()
    const hostB = hostEl()
    const first = await mountYouTubeEmbed({ host: hostA, videoId: 'aaaaaaaaaaa' })
    const second = await mountYouTubeEmbed({ host: hostB, videoId: 'bbbbbbbbbbb' })
    expect(first).not.toBeNull()
    expect(second).not.toBeNull()
    expect(hostA.innerHTML).toBe('') // previous embed destroyed by the new mount
    expect(destroyCalls).toBe(1)

    destroyYouTubeEmbed()
    expect(hostB.innerHTML).toBe('')
    expect(destroyCalls).toBe(2)
  })

  it('the API script is single-flight and a failed load retries on the next mount', async () => {
    const loadApi = vi
      .fn()
      .mockRejectedValueOnce(new Error('first try'))
      .mockImplementation(async () => {
        setFakeYT()
      })
    const host = hostEl()

    await expect(mountYouTubeEmbed({ host, videoId: 'dQw4w9WgXcQ', loadApi })).resolves.toBeNull()
    expect(loadApi).toHaveBeenCalledTimes(1)

    const handle = await mountYouTubeEmbed({ host, videoId: 'dQw4w9WgXcQ', loadApi })
    expect(handle).not.toBeNull()
    expect(loadApi).toHaveBeenCalledTimes(2) // rejection cleared the shared promise

    // A third mount reuses the now-resolved state without another load.
    const again = await mountYouTubeEmbed({ host, videoId: 'dQw4w9WgXcQ', loadApi })
    expect(again).not.toBeNull()
    expect(loadApi).toHaveBeenCalledTimes(2)
  })

  it('loadYoutubeIframeApi resolves immediately when YT.Player already exists', async () => {
    setFakeYT()
    const loadApi = vi.fn()
    await loadYoutubeIframeApi(loadApi)
    expect(loadApi).not.toHaveBeenCalled()
  })
})
