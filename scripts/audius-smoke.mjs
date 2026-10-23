/**
 * Audius live smoke harness — real search + real playback in a browser.
 *
 * Proves the primary external provider end to end against the live public
 * Audius API (free plan, no credentials required):
 *   build (VITE_AUDIUS_ENABLED=1) -> preview -> browser search ->
 *   Audius rows (au-song-*) with resolved artist names (remote registry) ->
 *   click-to-play -> player bar playing -> elapsed time advancing ->
 *   /stream request issued (302 to Audius CDN, <audio> follows it).
 *
 * Usage:
 *   npm run smoke:audius
 *   npm run smoke:audius -- --query=love
 *   npm run smoke:audius -- --site=https://<user>.github.io/<repo>
 *   VITE_AUDIUS_API_KEY=... npm run smoke:audius   # optional key
 *
 * Exit codes: 0 = pass, 1 = fail. Needs network — this is the manual live
 * check; the unit/e2e suites stay credential-less and offline by design.
 *
 * Report: replica/audius-smoke-report.json (URLs, counts, timings — no keys).
 */
import { chromium } from '@playwright/test'
import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const REPORT_PATH = join(root, 'replica', 'audius-smoke-report.json')
const LOCAL_PREVIEW = 'http://127.0.0.1:4175'

function argValue(name) {
  const prefix = `--${name}=`
  const hit = process.argv.find((a) => a.startsWith(prefix))
  return hit ? hit.slice(prefix.length) : ''
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
  else console.error(`\nFAIL ${message}`)
  process.exit(code)
}

async function browserChecks(baseUrl, query) {
  const browser = await chromium.launch()
  const page = await browser.newPage()
  const net = { audiusApiRequests: 0, streamRequests: 0, mediaResponses: 0, appleApiRequests: 0 }
  const pageErrors = []
  page.on('pageerror', (err) => pageErrors.push(String(err).slice(0, 200)))
  page.on('request', (req) => {
    const url = req.url()
    if (url.includes('api.audius.co')) net.audiusApiRequests += 1
    if (url.includes('/stream')) net.streamRequests += 1
    if (url.includes('api.music.apple.com')) net.appleApiRequests += 1
  })
  page.on('response', (res) => {
    if (res.request().resourceType() === 'media' && res.ok()) net.mediaResponses += 1
  })

  const out = {
    auRows: 0,
    firstTitle: null,
    firstArtist: null,
    artistResolved: false,
    playerVisible: false,
    playing: false,
    elapsed: [],
    timeAdvanced: false,
    net,
    pageErrors,
  }
  try {
    await page.goto(`${baseUrl}/search`, { waitUntil: 'domcontentloaded' })
    await page.fill('#search-input', query)

    try {
      await page.waitForSelector('.song-row[data-song-id^="au-song-"]', { timeout: 25_000 })
    } catch {
      /* counted below */
    }
    const row = page.locator('.song-row[data-song-id^="au-song-"]').first()
    out.auRows = await page.locator('.song-row[data-song-id^="au-song-"]').count()
    if (out.auRows > 0) {
      out.firstTitle = (await row.locator('.row-title').textContent())?.trim() ?? null
      out.firstArtist = (await row.locator('.row-sub').textContent())?.trim() ?? null
      out.artistResolved = Boolean(out.firstArtist) && out.firstArtist !== 'Unknown Artist'

      await row.click()
      const bar = page.locator('.player-bar')
      try {
        await bar.waitFor({ state: 'visible', timeout: 15_000 })
        out.playerVisible = true
        await page.waitForFunction(
          () => document.querySelector('.player-bar [data-action="toggle-play"]')?.getAttribute('aria-label') === 'Pause',
          undefined,
          { timeout: 15_000 },
        )
        out.playing = true
      } catch {
        /* reported as false */
      }

      if (out.playing) {
        const readElapsed = () =>
          page
            .locator('.player-progress .elapsed')
            .textContent()
            .then((t) => (t ?? '').trim())
            .catch(() => '')
        const toSec = (t) => {
          const m = /^(\d+):(\d+)$/.exec(t || '')
          return m ? Number(m[1]) * 60 + Number(m[2]) : -1
        }
        // Cold CDN starts (302 -> 307 -> ranged 206) can take a few seconds
        // before currentTime moves; poll up to 15s for the first tick.
        const baseline = await readElapsed()
        out.elapsed.push(baseline)
        const deadline = Date.now() + 15_000
        let current = baseline
        while (Date.now() < deadline && toSec(current) <= toSec(baseline)) {
          await sleep(500)
          current = await readElapsed()
          if (current && current !== baseline) {
            out.elapsed.push(current)
            break
          }
        }
        out.timeAdvanced = toSec(current) > toSec(baseline)
      }
    }
    return out
  } finally {
    await page.close().catch(() => {})
    await browser.close().catch(() => {})
  }
}

async function main() {
  const siteArg = argValue('site').replace(/\/+$/, '')
  const query = argValue('query') || 'love'
  const deployed = Boolean(siteArg)

  let preview = null
  let baseUrl
  try {
    if (deployed) {
      baseUrl = siteArg
      console.log(`deployed mode: ${baseUrl}`)
    } else {
      console.log('building with VITE_AUDIUS_ENABLED=1 (local mode)...')
      await run('npm', ['run', 'build'], {
        ...process.env,
        VITE_BASE: '/',
        VITE_AUDIUS_ENABLED: '1',
      })
      preview = spawn(
        'npm',
        ['run', 'preview', '--', '--host', '127.0.0.1', '--port', '4175', '--strictPort'],
        { cwd: root, stdio: 'ignore', detached: false },
      )
      preview.on('error', () => {})
      await waitForServer(LOCAL_PREVIEW)
      baseUrl = LOCAL_PREVIEW
    }

    const browser = await browserChecks(baseUrl, query)
    const pass =
      browser.auRows > 0 &&
      browser.artistResolved &&
      browser.playerVisible &&
      browser.playing &&
      browser.timeAdvanced &&
      browser.net.streamRequests > 0

    const report = {
      ranAt: new Date().toISOString(),
      mode: deployed ? 'deployed' : 'local',
      query,
      search: {
        auRows: browser.auRows,
        firstTitle: browser.firstTitle,
        firstArtist: browser.firstArtist,
        artistResolved: browser.artistResolved,
      },
      playback: {
        playerVisible: browser.playerVisible,
        playing: browser.playing,
        elapsed: browser.elapsed,
        timeAdvanced: browser.timeAdvanced,
      },
      network: browser.net,
      pageErrors: browser.pageErrors,
      pass,
    }
    writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`)
    console.log(`report written: ${REPORT_PATH}`)

    if (!pass) {
      finish(
        1,
        `audius smoke incomplete (auRows=${browser.auRows} artistResolved=${browser.artistResolved} ` +
          `playing=${browser.playing} timeAdvanced=${browser.timeAdvanced} ` +
          `streamRequests=${browser.net.streamRequests} audiusApiRequests=${browser.net.audiusApiRequests}` +
          `${browser.pageErrors.length ? ` pageErrors=${JSON.stringify(browser.pageErrors)}` : ''})`,
      )
    }
    finish(
      0,
      `auRows=${browser.auRows} artist="${browser.firstArtist}" title="${browser.firstTitle}" ` +
        `elapsed=${browser.elapsed.join('->')} streamRequests=${browser.net.streamRequests} ` +
        `audiusApiRequests=${browser.net.audiusApiRequests}`,
    )
  } finally {
    if (preview && !preview.killed) preview.kill('SIGTERM')
  }
}

main().catch((err) => {
  finish(1, err instanceof Error ? err.message : String(err))
})
