/**
 * Jamendo live smoke harness — real search + real playback in a browser.
 *
 * Proves the optional Jamendo provider end to end against the live public
 * Jamendo read API (free client id, documented GET parameter):
 *   build (VITE_AUDIUS_ENABLED=0, VITE_JAMENDO_CLIENT_ID set) -> preview ->
 *   browser search -> Jamendo rows (jm-song-*) with the source badge and
 *   resolved artist names (remote registry) -> click-to-play -> player bar
 *   playing -> elapsed time advancing -> storage.jamendo.com media request ->
 *   song page shows the CC licence + source attribution.
 *
 * Usage:
 *   VITE_JAMENDO_CLIENT_ID=... npm run smoke:jamendo
 *   npm run smoke:jamendo -- --query=harbor
 *   npm run smoke:jamendo -- --site=https://<user>.github.io/<repo>
 *   VITE_JAMENDO_ENABLED=0 npm run smoke:jamendo   # exits 2 (provider off)
 *
 * Exit codes: 0 = pass, 1 = fail, 2 = Jamendo not configured (no client id
 * or explicitly disabled — nothing verified, not a failure of the app).
 * Needs network — this is the manual live check; the unit/e2e suites stay
 * credential-less and offline by design.
 *
 * Report: replica/jamendo-smoke-report.json (URLs, counts, timings — never
 * the client id itself).
 */
import { chromium } from '@playwright/test'
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const REPORT_PATH = join(root, 'replica', 'jamendo-smoke-report.json')
const LOCAL_PREVIEW = 'http://127.0.0.1:4176'

function argValue(name) {
  const prefix = `--${name}=`
  const hit = process.argv.find((a) => a.startsWith(prefix))
  return hit ? hit.slice(prefix.length) : ''
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Client id resolution: shell env first, then .env (the file Vite itself reads). */
function readJamendoConfig() {
  const fromEnv = (process.env.VITE_JAMENDO_CLIENT_ID ?? '').trim()
  const enabledRaw = (process.env.VITE_JAMENDO_ENABLED ?? '').trim()
  let clientId = fromEnv
  let enabled = enabledRaw
  const envPath = join(root, '.env')
  if ((!clientId || !enabled) && existsSync(envPath)) {
    const text = readFileSync(envPath, 'utf8')
    const pick = (key) => {
      const m = new RegExp(`^${key}=(.*)$`, 'm').exec(text)
      return m ? m[1].replace(/\s+#.*$/, '').trim() : ''
    }
    if (!clientId) clientId = pick('VITE_JAMENDO_CLIENT_ID')
    if (!enabled) enabled = pick('VITE_JAMENDO_ENABLED')
  }
  const disabled = ['0', 'false', 'no', 'off'].includes(enabled.toLowerCase())
  return { clientId, disabled }
}

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
  else if (code === 2) console.error(`\nSKIP ${message}`)
  else console.error(`\nFAIL ${message}`)
  process.exit(code)
}

async function browserChecks(baseUrl, query) {
  const browser = await chromium.launch()
  const page = await browser.newPage()
  const net = { jamendoApiRequests: 0, streamRequests: 0, mediaResponses: 0, audiusApiRequests: 0, appleApiRequests: 0 }
  const pageErrors = []
  page.on('pageerror', (err) => pageErrors.push(String(err).slice(0, 200)))
  page.on('request', (req) => {
    const url = req.url()
    if (url.includes('api.jamendo.com')) net.jamendoApiRequests += 1
    if (url.includes('storage.jamendo.com') || url.includes('trackid=')) net.streamRequests += 1
    if (url.includes('api.audius.co')) net.audiusApiRequests += 1
    if (url.includes('api.music.apple.com')) net.appleApiRequests += 1
  })
  page.on('response', (res) => {
    if (res.request().resourceType() === 'media' && res.ok()) net.mediaResponses += 1
  })

  const out = {
    jmRows: 0,
    firstTitle: null,
    firstArtist: null,
    firstSongId: null,
    artistResolved: false,
    badgeVisible: false,
    playerVisible: false,
    playing: false,
    elapsed: [],
    timeAdvanced: false,
    attribution: null,
    net,
    pageErrors,
  }
  try {
    await page.goto(`${baseUrl}/search`, { waitUntil: 'domcontentloaded' })
    await page.fill('#search-input', query)

    try {
      await page.waitForSelector('.song-row[data-song-id^="jm-song-"]', { timeout: 25_000 })
    } catch {
      /* counted below */
    }
    const row = page.locator('.song-row[data-song-id^="jm-song-"]').first()
    out.jmRows = await page.locator('.song-row[data-song-id^="jm-song-"]').count()
    if (out.jmRows > 0) {
      out.firstSongId = await row.getAttribute('data-song-id')
      out.firstTitle = (await row.locator('.row-title').textContent())?.trim() ?? null
      out.firstArtist = (await row.locator('.row-sub').textContent())?.trim() ?? null
      out.artistResolved = Boolean(out.firstArtist) && out.firstArtist !== 'Unknown Artist'
      out.badgeVisible = (await row.locator('.source-badge').count()) > 0

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
        // Jamendo storage may stream cold (redirects + ranged responses);
        // poll up to 15s for the first elapsed-time tick.
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

      // Song page: the CC licence + source attribution line must be there.
      if (out.firstSongId) {
        await page.goto(`${baseUrl}/song/${out.firstSongId}`, { waitUntil: 'domcontentloaded' })
        try {
          await page.waitForSelector('.hero-license', { timeout: 15_000 })
          const license = page.locator('.hero-license')
          const text = ((await license.textContent()) ?? '').replace(/\s+/g, ' ').trim()
          const hasCcLink = (await license.locator('a[href*="creativecommons.org"]').count()) > 0
          const hasSourceLink = (await license.locator('a[target="_blank"]').count()) > 0
          out.attribution = { text: text.slice(0, 300), hasCcLink, hasSourceLink }
        } catch {
          /* reported as null */
        }
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
  const { clientId, disabled } = readJamendoConfig()

  if (!deployed) {
    if (disabled) {
      finish(2, `Jamendo is disabled (VITE_JAMENDO_ENABLED=${process.env.VITE_JAMENDO_ENABLED || '0|false|no|off'} in effect) — nothing to verify`)
    }
    if (!clientId) {
      finish(2, 'VITE_JAMENDO_CLIENT_ID not set (see .env.example → get a free id at https://devportal.jamendo.com) — nothing to verify')
    }
  }

  let preview = null
  let baseUrl
  try {
    if (deployed) {
      baseUrl = siteArg
      console.log(`deployed mode: ${baseUrl}`)
    } else {
      console.log('building with VITE_AUDIUS_ENABLED=0 (Jamendo-only remote, local mode)...')
      await run('npm', ['run', 'build'], {
        ...process.env,
        VITE_BASE: '/',
        VITE_AUDIUS_ENABLED: '0',
        VITE_JAMENDO_ENABLED: '1',
        VITE_JAMENDO_CLIENT_ID: clientId,
      })
      preview = spawn(
        'npm',
        ['run', 'preview', '--', '--host', '127.0.0.1', '--port', '4176', '--strictPort'],
        { cwd: root, stdio: 'ignore', detached: false },
      )
      preview.on('error', () => {})
      await waitForServer(LOCAL_PREVIEW)
      baseUrl = LOCAL_PREVIEW
    }

    const browser = await browserChecks(baseUrl, query)
    const attributionOk =
      browser.attribution !== null &&
      browser.attribution.hasCcLink &&
      /Jamendo/i.test(browser.attribution.text)
    const pass =
      browser.jmRows > 0 &&
      browser.badgeVisible &&
      browser.artistResolved &&
      browser.playerVisible &&
      browser.playing &&
      browser.timeAdvanced &&
      browser.net.streamRequests > 0 &&
      browser.net.jamendoApiRequests > 0 &&
      browser.net.audiusApiRequests === 0 &&
      browser.net.appleApiRequests === 0 &&
      attributionOk

    const report = {
      ranAt: new Date().toISOString(),
      mode: deployed ? 'deployed' : 'local',
      query,
      clientConfigured: deployed ? 'unknown (build not inspected)' : true, // never the id itself
      search: {
        jmRows: browser.jmRows,
        firstSongId: browser.firstSongId,
        firstTitle: browser.firstTitle,
        firstArtist: browser.firstArtist,
        artistResolved: browser.artistResolved,
        badgeVisible: browser.badgeVisible,
      },
      playback: {
        playerVisible: browser.playerVisible,
        playing: browser.playing,
        elapsed: browser.elapsed,
        timeAdvanced: browser.timeAdvanced,
      },
      attribution: browser.attribution,
      network: browser.net,
      pageErrors: browser.pageErrors,
      pass,
    }
    writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`)
    console.log(`report written: ${REPORT_PATH}`)

    if (!pass) {
      finish(
        1,
        `jamendo smoke incomplete (jmRows=${browser.jmRows} badgeVisible=${browser.badgeVisible} ` +
          `artistResolved=${browser.artistResolved} playing=${browser.playing} ` +
          `timeAdvanced=${browser.timeAdvanced} streamRequests=${browser.net.streamRequests} ` +
          `jamendoApiRequests=${browser.net.jamendoApiRequests} attribution=${attributionOk}` +
          `${browser.pageErrors.length ? ` pageErrors=${JSON.stringify(browser.pageErrors)}` : ''})`,
      )
    }
    finish(
      0,
      `jmRows=${browser.jmRows} artist="${browser.firstArtist}" title="${browser.firstTitle}" ` +
        `elapsed=${browser.elapsed.join('->')} streamRequests=${browser.net.streamRequests} ` +
        `jamendoApiRequests=${browser.net.jamendoApiRequests} attribution=${attributionOk}`,
    )
  } finally {
    if (preview && !preview.killed) preview.kill('SIGTERM')
  }
}

main().catch((err) => {
  finish(1, err instanceof Error ? err.message : String(err))
})
