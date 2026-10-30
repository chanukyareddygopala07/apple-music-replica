/**
 * Captures clone screenshots + smoke-checks playback wiring against the
 * local Vite preview build. Writes to replica/clone-screens/.
 */
import { chromium } from '@playwright/test'
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'replica', 'clone-screens')
mkdirSync(outDir, { recursive: true })

const BASE = 'http://127.0.0.1:4173'
const DESKTOP = { width: 1440, height: 900 }
const MOBILE = { width: 390, height: 844 }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function waitForServer(url, timeoutMs = 20_000) {
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

async function shot(page, name) {
  await page.screenshot({ path: join(outDir, `${name}.png`) })
  console.log('saved', name)
}

async function main() {
  const server = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', '4173', '--strictPort'], {
    cwd: root,
    stdio: 'pipe',
  })
  const consoleErrors = []
  const failedRequests = []
  try {
    await waitForServer(BASE)
    const browser = await chromium.launch()

    // ---- Desktop ----
    const ctx = await browser.newContext({ viewport: DESKTOP, locale: 'en-US' })
    const page = await ctx.newPage()
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text())
    })
    page.on('pageerror', (err) => consoleErrors.push(String(err)))
    page.on('requestfailed', (req) => {
      const u = req.url()
      // SoundHelix audio is remote and optional for layout captures
      if (!u.includes('soundhelix.com')) failedRequests.push(u)
    })

    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await sleep(800)
    await shot(page, 'S01-home-desktop')

    await page.click('a[data-nav-href="/browse"] >> nth=0')
    await sleep(600)
    await shot(page, 'S02-browse-desktop')

    await page.click('a[data-nav-href="/radio"] >> nth=0')
    await sleep(600)
    await shot(page, 'S03-radio-desktop')

    await page.click('a[data-nav-href="/search"] >> nth=0')
    await sleep(400)
    await page.fill('#search-input', 'harbor')
    await sleep(700)
    await shot(page, 'S05-search-desktop')

    await page.goto(`${BASE}/album/al-tidal-lines`, { waitUntil: 'domcontentloaded' })
    await sleep(700)
    await shot(page, 'S06-album-desktop')

    await page.goto(`${BASE}/artist/a-neon-harbor`, { waitUntil: 'domcontentloaded' })
    await sleep(700)
    await shot(page, 'S07-artist-desktop')

    // Playback smoke: play first track on the album page
    await page.goto(`${BASE}/album/al-tidal-lines`, { waitUntil: 'domcontentloaded' })
    await sleep(500)
    await page.click('.song-row >> nth=0')
    await sleep(1200)
    const barVisible = await page.locator('.player-bar').isVisible()
    const nowPlayingTitle = await page.locator('.pl-title').textContent()
    await shot(page, 'S08-player-playing-desktop')

    // Now Playing overlay + queue panel
    await page.goto(`${BASE}/now-playing?panel=queue`, { waitUntil: 'domcontentloaded' })
    await sleep(600)
    await shot(page, 'S08b-now-playing-queue-desktop')

    // Library
    await page.goto(`${BASE}/library`, { waitUntil: 'domcontentloaded' })
    await sleep(500)
    await shot(page, 'S09-library-desktop')

    // Playlist (editorial)
    await page.goto(`${BASE}/playlist/pl-deep-focus`, { waitUntil: 'domcontentloaded' })
    await sleep(600)
    await shot(page, 'S10-playlist-desktop')

    // Dark mode
    await page.evaluate(() => {
      localStorage.setItem(
        'realaxify:prefs:v1',
        JSON.stringify({ v: 1, data: { volume: 0.8, muted: false, shuffle: false, repeat: 'off', theme: 'dark', session: null } }),
      )
    })
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' })
    await sleep(500)
    await shot(page, 'S01b-home-dark-desktop')

    // ---- Mobile ----
    const mctx = await browser.newContext({ viewport: MOBILE, locale: 'en-US', isMobile: true, hasTouch: true })
    const mp = await mctx.newPage()
    mp.on('pageerror', (err) => consoleErrors.push(`mobile: ${String(err)}`))
    await mp.goto(BASE, { waitUntil: 'domcontentloaded' })
    await sleep(600)
    await shot(mp, 'S01-home-mobile')
    await mp.goto(`${BASE}/album/al-tidal-lines`, { waitUntil: 'domcontentloaded' })
    await sleep(600)
    await shot(mp, 'S06-album-mobile')

    const report = {
      barVisible,
      nowPlayingTitle: nowPlayingTitle?.trim(),
      consoleErrors,
      failedRequests,
    }
    writeFileSync(join(outDir, 'smoke-report.json'), JSON.stringify(report, null, 2))
    console.log('smoke report:', JSON.stringify(report, null, 2))
    await browser.close()
  } finally {
    server.kill('SIGTERM')
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
