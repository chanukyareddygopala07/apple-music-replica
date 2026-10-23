/**
 * MusicKit M1 live smoke harness.
 *
 * End-to-end proof that the real token pipeline works:
 *   signer /token -> build with VITE_MUSICKIT_ENABLED=1 -> preview (or a
 *   deployed site) -> browser search -> MusicKit configure + catalog search
 *   with the fetched developer token.
 *
 * Usage:
 *   npm run smoke:musickit
 *   npm run smoke:musickit -- --url=https://<worker>.workers.dev/token
 *   npm run smoke:musickit -- --site=https://<user>.github.io/<repo> --url=...
 *
 * Options:
 *   --url=    token service URL (default: env VITE_MUSICKIT_TOKEN_URL)
 *   --site=   deployed origin+path; runs against that site instead of a
 *             local build+preview
 *   --query=  search term (default: love)
 *
 * Exit codes: 0 = pass, 1 = fail, 2 = blocked (token URL not configured).
 *
 * The report written to replica/musickit-smoke-report.json never contains
 * the JWT, the token URL, the Team ID or the key id.
 */
import { chromium } from '@playwright/test'
import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const REPORT_PATH = join(root, 'replica', 'musickit-smoke-report.json')
const LOCAL_ORIGIN = 'http://127.0.0.1:4174'
const LOCAL_PREVIEW = 'http://127.0.0.1:4174'
const APPLE_MAX_TTL_SEC = 15_777_000

function argValue(name) {
  const prefix = `--${name}=`
  const hit = process.argv.find((a) => a.startsWith(prefix))
  return hit ? hit.slice(prefix.length) : ''
}

function decodeJwtParts(token) {
  const parts = String(token).split('.')
  if (parts.length !== 3 || parts.some((p) => !p)) return null
  try {
    const decode = (s) =>
      JSON.parse(Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'))
    return { header: decode(parts[0]), payload: decode(parts[1]) }
  } catch {
    return null
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function waitForServer(url, timeoutMs = 30_000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url)
      if (res.ok) return
    } catch {
      /* retry */
    }
    await sleep(250)
  }
  throw new Error(`Preview server did not start at ${url}`)
}

function run(cmd, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: root, env, stdio: 'inherit' })
    child.on('error', reject)
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(' ')} exited with code ${code}`)),
    )
  })
}

function finish(code, message) {
  if (code === 0) console.log(`\nPASS ${message}`)
  else if (code === 2) console.error(`\nBLOCKED (M1) ${message}`)
  else console.error(`\nFAIL ${message}`)
  process.exit(code)
}

async function precheckToken(tokenUrl, origin) {
  let res
  try {
    res = await fetch(tokenUrl, { headers: { Origin: origin, Accept: 'application/json' } })
  } catch (err) {
    finish(1, `token service unreachable: ${err instanceof Error ? err.message : String(err)}`)
  }
  if (res.status === 403) {
    finish(
      1,
      `signer rejected Origin "${origin}" — add it to ALLOWED_ORIGINS and redeploy the signer. ` +
        '(The browser Origin has no path: use scheme://host[:port] only.)',
    )
  }
  if (!res.ok) finish(1, `token service returned HTTP ${res.status}`)
  let body
  try {
    body = await res.json()
  } catch {
    finish(1, 'token service returned malformed JSON')
  }
  const token = typeof body?.token === 'string' ? body.token : ''
  const jwt = decodeJwtParts(token)
  if (!token || !jwt) finish(1, 'token service response is not a well-formed JWT')

  const now = Math.floor(Date.now() / 1000)
  const { header, payload } = jwt
  const expValid =
    Number.isFinite(payload.exp) && payload.exp > now && payload.exp <= now + APPLE_MAX_TTL_SEC
  const ttlSeconds =
    Number.isFinite(payload.exp) && Number.isFinite(payload.iat) ? payload.exp - payload.iat : null
  const originClaim = Array.isArray(payload.origin) ? payload.origin.map(String) : null
  const checks = {
    expValid,
    ttlSeconds,
    kidPresent: Boolean(header.kid),
    issPresent: Boolean(payload.iss),
    originClaimIncluded: originClaim !== null,
    originClaimHasOrigin: originClaim === null ? null : originClaim.includes(origin),
  }
  if (!expValid) finish(1, `token exp/iat out of range (ttl=${ttlSeconds}s)`)
  if (!checks.kidPresent || !checks.issPresent) finish(1, 'token is missing kid or iss claims')
  if (checks.originClaimHasOrigin === false) {
    finish(
      1,
      `JWT origin claim ${JSON.stringify(originClaim)} does not include "${origin}" — ` +
        'Apple will ignore the token for this site; fix ALLOWED_ORIGINS and redeploy the signer.',
    )
  }
  console.log(
    `token service OK: expValid ttl=${ttlSeconds}s kid=${checks.kidPresent} ` +
      `iss=${checks.issPresent} originClaim=${checks.originClaimIncluded}`,
  )
  return checks
}

async function browserChecks(baseUrl, query) {
  const browser = await chromium.launch()
  const page = await browser.newPage()
  let appleApiRequests = 0
  page.on('request', (req) => {
    if (req.url().includes('api.music.apple.com')) appleApiRequests += 1
  })

  let outcome = {
    sdkLoaded: false,
    configureOk: false,
    apiSearchOk: false,
    songCount: 0,
    apiError: null,
  }
  try {
    await page.goto(`${baseUrl}/search`, { waitUntil: 'domcontentloaded' })
    await page.fill('#search-input', query)

    let mkRows = 0
    try {
      await page.waitForSelector('[data-song-id^="mk-song-"]', { timeout: 20_000 })
    } catch {
      /* remote rows are one of two pass paths — checked below */
    }
    mkRows = await page.locator('[data-song-id^="mk-song-"]').count()

    let sdkLoaded = false
    try {
      await page.waitForFunction(() => Boolean(window.MusicKit), undefined, { timeout: 20_000 })
      sdkLoaded = true
    } catch {
      /* reported as false */
    }

    if (sdkLoaded) {
      const result = await page.evaluate(async (q) => {
        const MK = window.MusicKit
        const base = { sdkLoaded: true, configureOk: false, apiSearchOk: false, songCount: 0, apiError: null }
        if (!MK) return base
        const inst = typeof MK.getInstance === 'function' ? MK.getInstance() : null
        if (!inst) return base
        base.configureOk = true
        try {
          const res = await inst.api.search(q)
          const songs = res?.songs?.data ?? []
          base.songCount = songs.length
          base.apiSearchOk = songs.length > 0
        } catch (err) {
          base.apiError = String(err?.message ?? err).slice(0, 200)
        }
        return base
      }, query)
      outcome = { ...outcome, ...result }
    }
    return { ...outcome, mkRows, appleApiRequests }
  } finally {
    await page.close().catch(() => {})
    await browser.close().catch(() => {})
  }
}

async function main() {
  const tokenUrl = (argValue('url') || process.env.VITE_MUSICKIT_TOKEN_URL || '').trim()
  const siteArg = argValue('site').replace(/\/+$/, '')
  const query = argValue('query') || 'love'
  const deployed = Boolean(siteArg)

  if (!tokenUrl) {
    finish(
      2,
      'VITE_MUSICKIT_TOKEN_URL is not set. Complete README §1 (Apple enrollment, Media ID, ' +
        '.p8 download) and §2 (signer deploy), then rerun — M1 live criterion stays blocked until then.',
    )
  }

  // Browser Origin = scheme://host[:port] (never a path).
  const origin = deployed ? new URL(siteArg).origin : LOCAL_ORIGIN
  const tokenChecks = await precheckToken(tokenUrl, origin)

  let preview = null
  let baseUrl
  try {
    if (deployed) {
      baseUrl = siteArg
      console.log(`deployed mode: ${baseUrl}`)
    } else {
      console.log('building with VITE_MUSICKIT_ENABLED=1 (local mode)...')
      await run('npm', ['run', 'build'], {
        ...process.env,
        VITE_BASE: '/',
        VITE_MUSICKIT_ENABLED: '1',
        VITE_MUSICKIT_TOKEN_URL: tokenUrl,
        VITE_MUSICKIT_DEVELOPER_TOKEN: '',
      })
      preview = spawn(
        'npm',
        ['run', 'preview', '--', '--host', '127.0.0.1', '--port', '4174', '--strictPort'],
        { cwd: root, stdio: 'ignore', detached: false },
      )
      preview.on('error', () => {})
      await waitForServer(LOCAL_PREVIEW)
      baseUrl = LOCAL_PREVIEW
    }

    const browser = await browserChecks(baseUrl, query)
    const evidence = {
      tokenChecks,
      browser,
      pass:
        tokenChecks.expValid &&
        (browser.mkRows > 0 || browser.apiSearchOk),
    }

    const report = {
      ranAt: new Date().toISOString(),
      mode: deployed ? 'deployed' : 'local',
      origin,
      query,
      tokenChecks,
      browser: {
        sdkLoaded: browser.sdkLoaded,
        configureOk: browser.configureOk,
        apiSearchOk: browser.apiSearchOk,
        songCount: browser.songCount,
        mkRows: browser.mkRows,
        appleApiRequests: browser.appleApiRequests,
        apiError: browser.apiError,
      },
      pass: evidence.pass,
    }
    writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`)
    console.log(`report written: ${REPORT_PATH}`)

    if (!evidence.pass) {
      const reason = !browser.mkRows && !browser.apiSearchOk
        ? `no MusicKit catalog evidence (mkRows=${browser.mkRows} apiSearchOk=${browser.apiSearchOk} ` +
          `sdkLoaded=${browser.sdkLoaded} configureOk=${browser.configureOk}` +
          `${browser.apiError ? ` apiError="${browser.apiError}"` : ''})`
        : 'token checks failed'
      finish(1, reason)
    }
    finish(
      0,
      `mkRows=${browser.mkRows} apiSearchOk=${browser.apiSearchOk} songCount=${browser.songCount} ` +
        `appleApiRequests=${browser.appleApiRequests} configureOk=${browser.configureOk} ` +
        `— record this in replica/musickit-milestone.md M1`,
    )
  } finally {
    if (preview && !preview.killed) {
      preview.kill('SIGTERM')
    }
  }
}

main().catch((err) => {
  finish(1, err instanceof Error ? err.message : String(err))
})
