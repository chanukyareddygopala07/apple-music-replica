import { describe, expect, it, vi } from 'vitest'
import { AudiusClient, AudiusError } from '@/data/audius-client'

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

function clientWith(
  fetchFn: ReturnType<typeof vi.fn>,
  extra: { apiKey?: string; minGapMs?: number; sleep?: ReturnType<typeof vi.fn> } = {},
): AudiusClient {
  return new AudiusClient({
    fetchFn: fetchFn as unknown as (input: string, init?: RequestInit) => Promise<Response>,
    apiKey: extra.apiKey,
    minGapMs: extra.minGapMs ?? 0,
    sleep: extra.sleep ?? (async () => {}),
  })
}

describe('AudiusClient requests', () => {
  it('GETs JSON, unwraps { data } lists, and caches per URL', async () => {
    const fetchFn = vi.fn().mockResolvedValue(http({ data: [{ id: 'a' }] }))
    const client = clientWith(fetchFn)
    const first = await client.searchTracks('love')
    const second = await client.searchTracks('love')
    expect(first).toEqual([{ id: 'a' }])
    expect(second).toEqual([{ id: 'a' }])
    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(String(fetchFn.mock.calls[0]?.[0])).toContain('/tracks/search?query=love&limit=20&offset=0')
  })

  it('appends api_key when configured (SDK-style query transport)', async () => {
    const fetchFn = vi.fn().mockResolvedValue(http({ data: [] }))
    const client = clientWith(fetchFn, { apiKey: ' free-key ' })
    await client.searchTracks('x', 5)
    expect(String(fetchFn.mock.calls[0]?.[0])).toContain('api_key=free-key')
  })

  it('omits api_key for anonymous access', async () => {
    const fetchFn = vi.fn().mockResolvedValue(http({ data: [] }))
    await clientWith(fetchFn).searchTracks('x')
    expect(String(fetchFn.mock.calls[0]?.[0])).not.toContain('api_key')
  })

  it('clearCache forces a refetch', async () => {
    const fetchFn = vi.fn().mockResolvedValue(http({ data: [] }))
    const client = clientWith(fetchFn)
    await client.trendingTracks(3)
    client.clearCache()
    await client.trendingTracks(3)
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })

  it('enforces the minimum gap between request starts', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined)
    const fetchFn = vi.fn().mockResolvedValue(http({ data: [] }))
    const client = clientWith(fetchFn, { minGapMs: 130, sleep })
    await client.searchTracks('one')
    await client.searchTracks('two')
    expect(sleep).toHaveBeenCalledWith(130)
  })

  it('builds stream URLs without fetching them', () => {
    const client = new AudiusClient({ apiKey: 'k' })
    expect(client.streamUrl('6RN8l')).toBe('https://api.audius.co/v1/tracks/6RN8l/stream?api_key=k')
  })

  it('warms the per-track cache so getTrack needs no network', async () => {
    const fetchFn = vi.fn().mockResolvedValue(http({ data: [] }))
    const client = clientWith(fetchFn)
    client.warmTrackCache([{ id: 'T1', title: 'Warm' }])
    const track = await client.getTrack('T1')
    expect(track).toMatchObject({ id: 'T1' })
    expect(fetchFn).not.toHaveBeenCalled()
  })
})

describe('AudiusClient error handling', () => {
  it('retries 429 once with a capped backoff, then throws rate-limited', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined)
    const fetchFn = vi
      .fn()
      .mockResolvedValue(http({ errors: ['rate limited'] }, 429, { 'Retry-After': '9' }))
    const client = clientWith(fetchFn, { sleep })
    const err = await client.searchTracks('x').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(AudiusError)
    expect((err as AudiusError).code).toBe('rate-limited')
    expect((err as AudiusError).status).toBe(429)
    expect(fetchFn).toHaveBeenCalledTimes(2)
    expect(sleep).toHaveBeenCalledWith(2_000) // capped from Retry-After: 9s
  })

  it('succeeds when the 429 retry gets a 200', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined)
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(http({}, 429))
      .mockResolvedValueOnce(http({ data: [{ id: 'ok' }] }))
    const client = clientWith(fetchFn, { sleep })
    await expect(client.searchTracks('x')).resolves.toEqual([{ id: 'ok' }])
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })

  it('maps HTTP failures to typed errors', async () => {
    const cases: Array<[number, string]> = [
      [500, 'http'],
      [404, 'not-found'],
    ]
    for (const [status, code] of cases) {
      const client = clientWith(vi.fn().mockResolvedValue(http({}, status)))
      const err = await client.getTrack('x').catch((e: unknown) => e)
      expect((err as AudiusError).code).toBe(code)
    }
  })

  it('maps network failures, aborts and bad JSON to typed errors', async () => {
    const network = await clientWith(vi.fn().mockRejectedValue(new Error('offline')))
      .searchTracks('x')
      .catch((e: unknown) => e)
    expect((network as AudiusError).code).toBe('network')

    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' })
    const timeout = await clientWith(vi.fn().mockRejectedValue(abort))
      .searchTracks('x')
      .catch((e: unknown) => e)
    expect((timeout as AudiusError).code).toBe('timeout')

    const badJson = {
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => {
        throw new Error('not json')
      },
    } as unknown as Response
    const malformed = await clientWith(vi.fn().mockResolvedValue(badJson))
      .searchTracks('x')
      .catch((e: unknown) => e)
    expect((malformed as AudiusError).code).toBe('malformed')
  })

  it('does not cache failed requests', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(http({}, 500))
      .mockResolvedValueOnce(http({ data: [] }))
    const client = clientWith(fetchFn)
    await expect(client.trendingTracks(5)).rejects.toMatchObject({ code: 'http' })
    await expect(client.trendingTracks(5)).resolves.toEqual([])
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })
})
