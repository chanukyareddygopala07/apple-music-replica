import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MusicKitProvider } from '@/data/musickit-provider'

const CDN = 'https://js-cdn.music.apple.com/musickit/v3/musickit.js'

type MusicKitModule = typeof import('@/data/musickit-provider')

/** Fresh module state per test (single-flight script promise lives in the module). */
async function freshModule(): Promise<MusicKitModule> {
  vi.resetModules()
  return import('@/data/musickit-provider')
}

function configuredEnv(url = 'https://tokens.example/jwt'): void {
  vi.stubEnv('VITE_MUSICKIT_ENABLED', '1')
  vi.stubEnv('VITE_MUSICKIT_TOKEN_URL', url)
}

interface FakeMusicKit {
  configure: ReturnType<typeof vi.fn>
  getInstance: ReturnType<typeof vi.fn>
}

function installMusicKit(configure: (opts: Record<string, unknown>) => unknown): FakeMusicKit {
  const mk: FakeMusicKit = {
    configure: vi.fn(configure),
    getInstance: vi.fn(() => undefined),
  }
  ;(window as unknown as { MusicKit?: unknown }).MusicKit = mk
  return mk
}

let appendSpy: { mockRestore(): void } | null = null
let appendedScripts: HTMLScriptElement[] = []

/**
 * Intercept CDN script injection: when the SDK tag is appended, run `onLoad`
 * (installing the fake MusicKit global, simulating the CDN script executing)
 * and then fire the tag's load event.
 */
function interceptScriptLoad(onLoad: () => void): void {
  appendSpy = vi.spyOn(document.head, 'appendChild').mockImplementation((node: Node) => {
    if (node instanceof HTMLScriptElement && node.src.includes('music.apple.com')) {
      appendedScripts.push(node)
      queueMicrotask(() => {
        onLoad()
        node.onload?.(new Event('load'))
      })
      return node
    }
    return node
  })
}

function musicKitScripts(): HTMLScriptElement[] {
  return Array.from(document.querySelectorAll<HTMLScriptElement>('script')).filter((s) => s.src.includes('music.apple.com'))
}

beforeEach(() => {
  appendedScripts = []
  appendSpy = null
  delete (window as unknown as { MusicKit?: unknown }).MusicKit
})

afterEach(() => {
  appendSpy?.mockRestore()
  for (const el of musicKitScripts()) el.remove()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('credential-less configuration', () => {
  it('is not configured, and init() makes no token fetch or CDN request', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    appendSpy = vi.spyOn(document.head, 'appendChild') // counting spy, passthrough
    const mod = await freshModule()
    const provider: MusicKitProvider = new mod.MusicKitProvider()

    expect(provider.info.configured).toBe(false)
    expect(mod.isMusicKitConfigured()).toBe(false)

    await expect(provider.init()).resolves.toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(appendSpy).not.toHaveBeenCalled()
    expect(musicKitScripts()).toHaveLength(0)
    expect((window as unknown as { MusicKit?: unknown }).MusicKit).toBeUndefined()
  })

  it('search() falls back to empty MusicKit results without touching the network', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const mod = await freshModule()
    const provider: MusicKitProvider = new mod.MusicKitProvider()
    const res = await provider.search('harbor')
    expect(res.songs).toEqual([])
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(musicKitScripts()).toHaveLength(0)
  })

  it('authorize() reports unconfigured without touching the network', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const mod = await freshModule()
    const provider: MusicKitProvider = new mod.MusicKitProvider()
    await expect(provider.authorize()).resolves.toEqual({ ok: false, message: 'MusicKit is not configured.' })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('the catalogue facade stays on the demo provider (no MusicKit network activity)', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    vi.resetModules()
    const catalog = await import('@/data/catalog')
    const res = await catalog.search('harbor')
    expect(res.songs.length).toBeGreaterThan(0) // demo results still returned
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(musicKitScripts()).toHaveLength(0)
  })
})

describe('conditional initialization (gate + token + SDK)', () => {
  it('does not activate when only the flag is set (no token source)', async () => {
    vi.stubEnv('VITE_MUSICKIT_ENABLED', '1')
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const mod = await freshModule()
    const provider: MusicKitProvider = new mod.MusicKitProvider()
    expect(provider.info.configured).toBe(false)
    await expect(provider.init()).resolves.toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(musicKitScripts()).toHaveLength(0)
  })

  it('does not activate when only a token URL is set (flag off)', async () => {
    vi.stubEnv('VITE_MUSICKIT_TOKEN_URL', 'https://tokens.example/jwt')
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const mod = await freshModule()
    const provider: MusicKitProvider = new mod.MusicKitProvider()
    expect(provider.info.configured).toBe(false)
    await expect(provider.init()).resolves.toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('initializes with a runtime-fetched token when fully configured', async () => {
    configuredEnv()
    const token = 't1.dXNlcnM=.c2ln'
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ token }),
    })
    vi.stubGlobal('fetch', fetchSpy)
    const mod = await freshModule()
    // SDK already present: no script injection needed.
    const mk = installMusicKit(() => ({ api: {} }))
    const provider: MusicKitProvider = new mod.MusicKitProvider()

    expect(provider.info.configured).toBe(true)
    const music = await provider.init()
    expect(music).toEqual({ api: {} })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(mk.configure).toHaveBeenCalledWith(expect.objectContaining({ developerToken: token }))
    expect(musicKitScripts()).toHaveLength(0) // window.MusicKit pre-present
  })

  it('injects the MusicKit CDN script exactly once, only after a token is in hand', async () => {
    configuredEnv()
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ token: 't1.dXNlcnM=.c2ln' }),
    })
    vi.stubGlobal('fetch', fetchSpy)
    const mod = await freshModule()
    // window.MusicKit starts undefined; the fake SDK appears when the tag loads.
    const mkRef: { current: FakeMusicKit | null } = { current: null }
    interceptScriptLoad(() => {
      mkRef.current = installMusicKit(() => ({ api: {} }))
    })
    const provider: MusicKitProvider = new mod.MusicKitProvider()

    await provider.init()
    expect(appendedScripts).toHaveLength(1)
    expect(appendedScripts[0]!.src).toBe(CDN)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(mkRef.current?.configure).toHaveBeenCalledTimes(1)

    // init() is memoized — no second script, token fetch, or configure.
    await provider.init()
    expect(appendedScripts).toHaveLength(1)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(mkRef.current?.configure).toHaveBeenCalledTimes(1)
  })

  it('a failing token service means zero CDN requests (token-before-script ordering)', async () => {
    configuredEnv()
    const fetchSpy = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) })
    vi.stubGlobal('fetch', fetchSpy)
    const mod = await freshModule()
    const provider: MusicKitProvider = new mod.MusicKitProvider()

    await expect(provider.init()).resolves.toBeNull()
    expect(musicKitScripts()).toHaveLength(0)
    expect((window as unknown as { MusicKit?: unknown }).MusicKit).toBeUndefined()
  })

  it('a malformed token response also means zero CDN requests', async () => {
    configuredEnv()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ nope: 1 }) }))
    const mod = await freshModule()
    const provider: MusicKitProvider = new mod.MusicKitProvider()
    await expect(provider.init()).resolves.toBeNull()
    expect(musicKitScripts()).toHaveLength(0)
  })

  it('falls back to demo when the SDK fails to load (script onerror)', async () => {
    configuredEnv()
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ token: 't1.dXNlcnM=.c2ln' }),
    })
    vi.stubGlobal('fetch', fetchSpy)
    const mod = await freshModule()
    appendSpy = vi.spyOn(document.head, 'appendChild').mockImplementation((node: Node) => {
      if (node instanceof HTMLScriptElement && node.src.includes('music.apple.com')) {
        appendedScripts.push(node)
        queueMicrotask(() => node.onerror?.(new Event('error')))
        return node
      }
      return node
    })
    const provider: MusicKitProvider = new mod.MusicKitProvider()
    await expect(provider.init()).resolves.toBeNull()
    expect(appendedScripts).toHaveLength(1)
  })
})

describe('token refresh on rejected configure', () => {
  it('retries once with a freshly fetched token when configure rejects', async () => {
    configuredEnv()
    const token1 = 't1.dXNlcnM=.c2ln'
    const token2 = 't2.ZXhw$b3JlZA==.c2ln'
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ token: token1 }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ token: token2 }) })
    vi.stubGlobal('fetch', fetchSpy)
    const mod = await freshModule()
    const mk = installMusicKit((opts) => {
      if (opts['developerToken'] === token1) throw new Error('TOKEN_REJECTED')
      return { api: {} }
    })
    const provider: MusicKitProvider = new mod.MusicKitProvider()

    const music = await provider.init()
    expect(music).toEqual({ api: {} })
    expect(fetchSpy).toHaveBeenCalledTimes(2)
    expect(mk.configure).toHaveBeenCalledTimes(2)
    expect(mk.configure).toHaveBeenNthCalledWith(1, expect.objectContaining({ developerToken: token1 }))
    expect(mk.configure).toHaveBeenNthCalledWith(2, expect.objectContaining({ developerToken: token2 }))
  })

  it('gives up after one retry when configure keeps rejecting (never throws)', async () => {
    configuredEnv()
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ token: 't1.dXNlcnM=.c2ln' }),
    })
    vi.stubGlobal('fetch', fetchSpy)
    const mod = await freshModule()
    const mk = installMusicKit(() => {
      throw new Error('ALWAYS_REJECTED')
    })
    const provider: MusicKitProvider = new mod.MusicKitProvider()
    await expect(provider.init()).resolves.toBeNull()
    expect(mk.configure).toHaveBeenCalledTimes(2)
    expect(fetchSpy).toHaveBeenCalledTimes(2) // initial + one forced refresh
  })

  it('does not retry a static (non-refreshable) token', async () => {
    vi.stubEnv('VITE_MUSICKIT_ENABLED', '1')
    vi.stubEnv('VITE_MUSICKIT_DEVELOPER_TOKEN', 's1.dXNlcnM=.c2ln')
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const mod = await freshModule()
    const mk = installMusicKit(() => {
      throw new Error('REJECTED')
    })
    const provider: MusicKitProvider = new mod.MusicKitProvider()
    expect(provider.info.configured).toBe(true)
    await expect(provider.init()).resolves.toBeNull()
    expect(mk.configure).toHaveBeenCalledTimes(1)
    expect(fetchSpy).not.toHaveBeenCalled() // static token needs no fetch at all
  })
})

describe('search mapping through a configured provider', () => {
  it('maps MusicKit search payloads to catalogue songs', async () => {
    configuredEnv()
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ token: 't1.dXNlcnM=.c2ln' }),
    })
    vi.stubGlobal('fetch', fetchSpy)
    const mod = await freshModule()
    installMusicKit(() => ({
      api: {
        search: async () => ({
          songs: {
            data: [
              { id: '1445732712', type: 'songs', attributes: { name: 'Signal Fire', artistName: 'Nori Vale', albumName: 'Static Bloom', durationInMillis: 240_000 } },
            ],
          },
        }),
      },
    }))
    const provider: MusicKitProvider = new mod.MusicKitProvider()
    const res = await provider.search('signal')
    expect(res.songs).toHaveLength(1)
    expect(res.songs[0]).toMatchObject({ id: 'mk-song-1445732712', title: 'Signal Fire', durationMs: 240_000 })
  })
})
