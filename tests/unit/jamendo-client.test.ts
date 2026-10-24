import { describe, expect, it, vi } from 'vitest'
import { JamendoClient, JamendoError } from '@/data/jamendo-client'

/** Minimal Response stand-in (jsdom has no Response global). */
function http(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  const lower: Record<string, string> = {}
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => lower[name.toLowerCase()] ?? null },
    json: async () => body,
  } as unknown as Response
}

function envelope(results: unknown[]): unknown {
  return { headers: { status: 'success', code: 0, error_message: '', results_count: results.length }, results }
}

function clientWith(
  fetchFn: ReturnType<typeof vi.fn>,
  extra: { clientId?: string; sleep?: ReturnType<typeof vi.fn>; now?: () => number } = {},
): JamendoClient {
  return new JamendoClient({
    fetchFn: fetchFn as unknown as (input: string, init?: RequestInit) => Promise<Response>,
    clientId: extra.clientId ?? 'test-client',
    sleep: extra.sleep ?? (async () => {}),
    now: extra.now,
  })
}

function callUrl(fetchFn: ReturnType<typeof vi.fn>, index = 0): URL {
  return new URL(String(fetchFn.mock.calls[index]?.[0]))
}

describe('JamendoClient request parameters (developer.jamendo.com/v3.0/tracks)', () => {
  it('always sends client_id + format and the documented tracks defaults', async () => {
    const fetchFn = vi.fn().mockResolvedValue(http(envelope([])))
    await clientWith(fetchFn).searchTracks({ query: 'harbor' })
    const url = callUrl(fetchFn)
    expect(url.origin + url.pathname).toBe('https://api.jamendo.com/v3.0/tracks')
    expect(url.searchParams.get('client_id')).toBe('test-client')
    expect(url.searchParams.get('format')).toBe('json')
    expect(url.searchParams.get('type')).toBe('single albumtrack') // singles must not vanish
    expect(url.searchParams.get('audioformat')).toBe('mp32') // stream format, not download
    expect(url.searchParams.get('imagesize')).toBe('600')
    expect(url.searchParams.get('include')).toBe('licenses musicinfo') // licence + language
    expect(url.searchParams.get('limit')).toBe('10')
    expect(url.searchParams.get('offset')).toBe('0')
  })

  it('uses relevance order only alongside a text search', async () => {
    const fetchFn = vi.fn().mockResolvedValue(http(envelope([])))
    const client = clientWith(fetchFn)
    await client.searchTracks({ query: 'harbor' })
    expect(callUrl(fetchFn).searchParams.get('order')).toBe('relevance')
    await client.searchTracks({ artistId: '42' })
    expect(callUrl(fetchFn, 1).searchParams.get('order')).toBeNull()
  })

  it('passes pagination, ids, name search and the lang filter through', async () => {
    const fetchFn = vi.fn().mockResolvedValue(http(envelope([])))
    await clientWith(fetchFn).searchTracks({ query: 'x', limit: 25, offset: 50, language: 'fr', id: '1848357' })
    const url = callUrl(fetchFn)
    expect(url.searchParams.get('limit')).toBe('25')
    expect(url.searchParams.get('offset')).toBe('50')
    expect(url.searchParams.get('lang')).toBe('fr')
    expect(url.searchParams.get('id')).toBe('1848357')
  })

  it('omits the lang parameter entirely when none is given (all languages)', async () => {
    const fetchFn = vi.fn().mockResolvedValue(http(envelope([])))
    await clientWith(fetchFn).searchTracks({ query: 'x' })
    expect(callUrl(fetchFn).searchParams.get('lang')).toBeNull()
  })

  it('preserves a Unicode query byte-for-byte through the wire encoding', async () => {
    const fetchFn = vi.fn().mockResolvedValue(http(envelope([])))
    await clientWith(fetchFn).searchTracks({ query: '周杰倫 愛在西元前' })
    expect(callUrl(fetchFn).searchParams.get('search')).toBe('周杰倫 愛在西元前')
  })
})

describe('JamendoClient responses', () => {
  it('unwraps results and treats a missing results array as empty', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(http(envelope([{ id: '1' }])))
      .mockResolvedValueOnce(http({ headers: { status: 'success' } }))
    const client = clientWith(fetchFn)
    await expect(client.searchTracks({ query: 'a' })).resolves.toEqual([{ id: '1' }])
    await expect(client.searchTracks({ query: 'b' })).resolves.toEqual([])
  })

  it('surfaces a documented API failure carried in a 200 envelope', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      http({ headers: { status: 'failed', code: 6, error_message: 'Invalid client_id' } }),
    )
    const err = await clientWith(fetchFn).searchTracks({ query: 'a' }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(JamendoError)
    expect((err as JamendoError).code).toBe('api')
    expect((err as JamendoError).message).toBe('Invalid client_id')
  })

  it('prefers the JSON error_message on HTTP failures', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      http({ headers: { status: 'failed', error_message: 'Wrong method' } }, 400),
    )
    const err = await clientWith(fetchFn).searchTracks({ query: 'a' }).catch((e: unknown) => e)
    expect((err as JamendoError).code).toBe('api')
    expect((err as JamendoError).message).toBe('Wrong method')
    expect((err as JamendoError).status).toBe(400)
  })
})

describe('JamendoClient error handling', () => {
  it('refuses to request at all without a client id (unconfigured)', async () => {
    const fetchFn = vi.fn()
    const client = clientWith(fetchFn, { clientId: '' })
    const err = await client.searchTracks({ query: 'a' }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(JamendoError)
    expect((err as JamendoError).code).toBe('unconfigured')
    expect((err as JamendoError).message).toContain('VITE_JAMENDO_CLIENT_ID')
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('maps transport failures to typed errors', async () => {
    const cases: Array<[() => unknown, string]> = [
      [() => new TypeError('Failed to fetch'), 'network'],
      [() => Object.assign(new Error('aborted'), { name: 'AbortError' }), 'timeout'],
      [() => Object.assign(new Error('late'), { name: 'TimeoutError' }), 'timeout'],
    ]
    for (const [makeErr, code] of cases) {
      const fetchFn = vi.fn().mockRejectedValueOnce(makeErr())
      const err = await clientWith(fetchFn).searchTracks({ query: 'a' }).catch((e: unknown) => e)
      expect((err as JamendoError).code).toBe(code)
    }
  })

  it('maps a non-JSON body to malformed', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => {
        throw new SyntaxError('Unexpected token <')
      },
    } as unknown as Response)
    const err = await clientWith(fetchFn).searchTracks({ query: 'a' }).catch((e: unknown) => e)
    expect((err as JamendoError).code).toBe('malformed')
  })

  it('maps a plain HTTP failure (no envelope) to http', async () => {
    const fetchFn = vi.fn().mockResolvedValue(http('<html>gateway</html>', 502))
    const err = await clientWith(fetchFn).searchTracks({ query: 'a' }).catch((e: unknown) => e)
    expect((err as JamendoError).code).toBe('http')
    expect((err as JamendoError).status).toBe(502)
  })

  it('retries 429 once with the capped Retry-After, then throws rate-limited', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined)
    const fetchFn = vi.fn().mockResolvedValue(http({}, 429, { 'Retry-After': '9' }))
    const err = await clientWith(fetchFn, { sleep }).searchTracks({ query: 'a' }).catch((e: unknown) => e)
    expect((err as JamendoError).code).toBe('rate-limited')
    expect((err as JamendoError).status).toBe(429)
    expect(fetchFn).toHaveBeenCalledTimes(2)
    expect(sleep).toHaveBeenCalledWith(2_000) // capped from Retry-After: 9s
  })

  it('succeeds when the 429 retry gets a 200', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined)
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(http({}, 429))
      .mockResolvedValueOnce(http(envelope([{ id: 'ok' }])))
    await expect(clientWith(fetchFn, { sleep }).searchTracks({ query: 'a' })).resolves.toEqual([{ id: 'ok' }])
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })
})

describe('JamendoClient caching', () => {
  it('serves identical requests from the TTL cache', async () => {
    const fetchFn = vi.fn().mockResolvedValue(http(envelope([{ id: '1' }])))
    const client = clientWith(fetchFn)
    await client.searchTracks({ query: 'harbor' })
    await client.searchTracks({ query: 'harbor' })
    expect(fetchFn).toHaveBeenCalledTimes(1)
    await client.searchTracks({ query: 'other' }) // different URL = different entry
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })

  it('expires cached entries once the TTL elapses', async () => {
    let now = 1_000
    const fetchFn = vi.fn().mockResolvedValue(http(envelope([])))
    const client = clientWith(fetchFn, { now: () => now })
    await client.searchTracks({ query: 'harbor', ttlMs: 60_000 })
    now += 60_001
    await client.searchTracks({ query: 'harbor', ttlMs: 60_000 })
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })

  it('clearCache forces a refetch', async () => {
    const fetchFn = vi.fn().mockResolvedValue(http(envelope([])))
    const client = clientWith(fetchFn)
    await client.searchTracks({ query: 'harbor' })
    client.clearCache()
    await client.searchTracks({ query: 'harbor' })
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })

  it('never caches failures (a later success still reaches the network)', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(http({}, 500))
      .mockResolvedValueOnce(http(envelope([{ id: 'later' }])))
    const client = clientWith(fetchFn)
    const err = await client.searchTracks({ query: 'a' }).catch((e: unknown) => e)
    expect((err as JamendoError).code).toBe('http')
    await expect(client.searchTracks({ query: 'a' })).resolves.toEqual([{ id: 'later' }])
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })
})
