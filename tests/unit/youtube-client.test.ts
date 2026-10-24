import { describe, expect, it, vi } from 'vitest'
import { YoutubeClient, YoutubeError, type YoutubeClientOptions } from '@/data/youtube-client'

function http(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => body,
  } as unknown as Response
}

function capturingFetch(
  body: unknown,
  status = 200,
): { fetchFn: YoutubeClientOptions['fetchFn']; urls: string[] } {
  const urls: string[] = []
  const fetchFn = vi.fn(async (input: string) => {
    urls.push(input)
    return http(body, status)
  })
  return { fetchFn, urls }
}

async function expectErrorType(fn: () => Promise<unknown>, code: string): Promise<void> {
  await expect(fn()).rejects.toSatisfy((err: unknown) => err instanceof YoutubeError && err.code === code)
}

describe('YoutubeClient URL building', () => {
  it('skips empty params and appends the key only when set', () => {
    const withKey = new YoutubeClient({ apiKey: 'k1', fetchFn: async () => http({}) })
    const url = withKey.buildUrl('/search', { part: 'snippet', relevanceLanguage: undefined, pageToken: '' })
    expect(url).toBe('https://www.googleapis.com/youtube/v3/search?part=snippet&key=k1')

    const keyless = new YoutubeClient({ fetchFn: async () => http({}) })
    expect(keyless.buildUrl('/search', { part: 'snippet' })).toBe(
      'https://www.googleapis.com/youtube/v3/search?part=snippet',
    )
  })
})

describe('YoutubeClient searchVideos (search.list)', () => {
  it('sends the documented params and returns items with the page token', async () => {
    const { fetchFn, urls } = capturingFetch({
      items: [
        { id: { videoId: 'dQw4w9WgXcQ' }, snippet: { title: 'A' } },
        { id: { kind: 'youtube#video' }, snippet: { title: 'no video id' } },
      ],
      nextPageToken: 'NEXT',
    })
    const client = new YoutubeClient({ apiKey: 'k1', fetchFn })
    const page = await client.searchVideos({
      query: 'harbor',
      language: 'fr',
      cursor: 'PREV',
      limit: 10,
    })

    const p = new URL(urls[0]!).searchParams
    expect(new URL(urls[0]!).pathname).toBe('/youtube/v3/search')
    expect(p.get('part')).toBe('snippet')
    expect(p.get('type')).toBe('video')
    expect(p.get('videoEmbeddable')).toBe('true')
    expect(p.get('q')).toBe('harbor')
    expect(p.get('maxResults')).toBe('10')
    expect(p.get('relevanceLanguage')).toBe('fr')
    expect(p.get('pageToken')).toBe('PREV')
    expect(p.get('key')).toBe('k1')
    expect(page.items).toHaveLength(1)
    expect(page.nextPageToken).toBe('NEXT')
  })

  it('omits relevanceLanguage when no language hint applies', async () => {
    const { fetchFn, urls } = capturingFetch({ items: [] })
    const client = new YoutubeClient({ fetchFn })
    await client.searchVideos({ query: 'x', language: undefined })
    expect(new URL(urls[0]!).searchParams.get('relevanceLanguage')).toBeNull()
  })
})

describe('YoutubeClient detail endpoints', () => {
  it('getVideos requests snippet,contentDetails,status (made-for-kids lookup)', async () => {
    const { fetchFn, urls } = capturingFetch({ items: [{ id: 'dQw4w9WgXcQ' }] })
    const client = new YoutubeClient({ fetchFn })
    const items = await client.getVideos(['dQw4w9WgXcQ'])
    expect(items).toHaveLength(1)
    const p = new URL(urls[0]!).searchParams
    expect(new URL(urls[0]!).pathname).toBe('/youtube/v3/videos')
    expect(p.get('part')).toBe('snippet,contentDetails,status')
    expect(p.get('id')).toBe('dQw4w9WgXcQ')
    await expect(client.getVideos([])).resolves.toEqual([])
  })

  it('getChannels requests only snippet', async () => {
    const { fetchFn, urls } = capturingFetch({ items: [{ id: 'UCx' }] })
    const client = new YoutubeClient({ fetchFn })
    await client.getChannels(['UCx'])
    const p = new URL(urls[0]!).searchParams
    expect(new URL(urls[0]!).pathname).toBe('/youtube/v3/channels')
    expect(p.get('part')).toBe('snippet')
    await expect(client.getChannels([])).resolves.toEqual([])
  })
})

describe('YoutubeClient error mapping', () => {
  it('maps quota, forbidden and relevanceLanguage failures to typed codes', async () => {
    const quota = new YoutubeClient({
      fetchFn: async () =>
        http({ error: { code: 403, message: 'quota', errors: [{ reason: 'quotaExceeded' }] } }, 403),
    })
    await expectErrorType(() => quota.searchVideos({ query: 'x' }), 'quota')

    const forbidden = new YoutubeClient({
      fetchFn: async () => http({ error: { code: 403, message: 'key bad' } }, 403),
    })
    await expectErrorType(() => forbidden.searchVideos({ query: 'x' }), 'forbidden')

    const relevance = new YoutubeClient({
      fetchFn: async () =>
        http({ error: { code: 400, message: 'bad lang', errors: [{ reason: 'invalidRelevanceLanguage' }] } }, 400),
    })
    await expectErrorType(() => relevance.searchVideos({ query: 'x' }), 'api')

    const other = new YoutubeClient({ fetchFn: async () => http({ error: { code: 400, message: 'nope' } }, 400) })
    await expectErrorType(() => other.searchVideos({ query: 'x' }), 'api')
  })

  it('maps invalid JSON, network failures and timeouts to typed codes', async () => {
    const malformed = new YoutubeClient({
      fetchFn: async () =>
        ({
          ok: true,
          status: 200,
          headers: { get: () => null },
          json: async () => {
            throw new Error('not json')
          },
        }) as unknown as Response,
    })
    await expectErrorType(() => malformed.searchVideos({ query: 'x' }), 'malformed')

    const offline = new YoutubeClient({
      fetchFn: async () => {
        throw new Error('offline')
      },
    })
    await expectErrorType(() => offline.searchVideos({ query: 'x' }), 'network')

    const aborted = new YoutubeClient({
      fetchFn: async () => {
        throw Object.assign(new Error('aborted'), { name: 'AbortError' })
      },
    })
    await expectErrorType(() => aborted.searchVideos({ query: 'x' }), 'timeout')
  })

  it('surfaces body.error even on a 200 response', async () => {
    const { fetchFn } = capturingFetch({ error: { code: 400, message: 'bad request' } })
    const client = new YoutubeClient({ fetchFn })
    await expectErrorType(() => client.searchVideos({ query: 'x' }), 'api')
  })
})

describe('YoutubeClient TTL cache (quota discipline)', () => {
  it('serves repeats from cache until TTL or clearCache', async () => {
    let t = 1_000
    const fetchFn = vi.fn(async () => http({ items: [] }))
    const client = new YoutubeClient({ fetchFn, now: () => t })

    await client.searchVideos({ query: 'harbor' })
    await client.searchVideos({ query: 'harbor' })
    expect(fetchFn).toHaveBeenCalledTimes(1)

    t += 61_000 // beyond the 60s search TTL
    await client.searchVideos({ query: 'harbor' })
    expect(fetchFn).toHaveBeenCalledTimes(2)

    await client.searchVideos({ query: 'harbor' })
    expect(fetchFn).toHaveBeenCalledTimes(2)
    client.clearCache()
    await client.searchVideos({ query: 'harbor' })
    expect(fetchFn).toHaveBeenCalledTimes(3)
  })

  it('keys the cache by full URL (different queries never collide)', async () => {
    const fetchFn = vi.fn(async () => http({ items: [] }))
    const client = new YoutubeClient({ fetchFn })
    await client.searchVideos({ query: 'one' })
    await client.searchVideos({ query: 'two' })
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })
})
