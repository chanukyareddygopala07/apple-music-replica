/**
 * Captures reference screenshots + measured metrics from music.apple.com
 * for the replica workflow. Read-only browsing of the public site.
 */
import { chromium } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'replica', 'screens')
mkdirSync(outDir, { recursive: true })

const HOME = 'https://music.apple.com/in/'
const DESKTOP = { width: 1440, height: 900 }
const MOBILE = { width: 390, height: 844 }

async function settle(page, ms = 2500) {
  await page.waitForTimeout(ms)
  // Dismiss common consent / sign-in prompts if present
  for (const name of [/accept/i, /agree/i, /continue/i, /close/i, /got it/i]) {
    try {
      const btn = page.getByRole('button', { name }).first()
      if (await btn.isVisible({ timeout: 400 })) await btn.click({ timeout: 800 }).catch(() => {})
    } catch {
      /* ignore */
    }
  }
}

async function shot(page, name) {
  const file = join(outDir, `${name}.png`)
  await page.screenshot({ path: file })
  console.log('saved', name)
}

async function clickNav(page, pattern) {
  const link = page
    .locator('a')
    .filter({ hasText: pattern })
    .first()
  if (await link.isVisible({ timeout: 2000 })) {
    await link.click()
    await page.waitForTimeout(2200)
    return true
  }
  return false
}

async function measure(page) {
  return page.evaluate(() => {
    const cs = (el) => (el ? getComputedStyle(el) : null)
    const sidebar =
      document.querySelector('[class*="sidebar" i]') ||
      document.querySelector('nav') ||
      document.querySelector('aside')
    const player =
      document.querySelector('[class*="playback" i]') ||
      document.querySelector('[class*="player" i]') ||
      document.querySelector('[role="region"][aria-label*="play" i]')
    const main = document.querySelector('main') || document.querySelector('[class*="content" i]')
    return {
      title: document.title,
      bodyBg: cs(document.body)?.backgroundColor,
      bodyColor: cs(document.body)?.color,
      bodyFont: cs(document.body)?.fontFamily,
      sidebarWidth: sidebar ? Math.round(sidebar.getBoundingClientRect().width) : null,
      sidebarBg: sidebar ? cs(sidebar).backgroundColor : null,
      mainBg: main ? cs(main).backgroundColor : null,
      playerHeight: player ? Math.round(player.getBoundingClientRect().height) : null,
      h1: (() => {
        const el = document.querySelector('h1')
        if (!el) return null
        const s = cs(el)
        return { text: el.textContent?.trim(), size: s.fontSize, weight: s.fontWeight }
      })(),
      hrefs: [...document.querySelectorAll('a[href]')]
        .slice(0, 0)
        .map((a) => a.getAttribute('href')),
    }
  })
}

async function main() {
  const browser = await chromium.launch()
  const metrics = {}

  // ---- Desktop ----
  const ctx = await browser.newContext({
    viewport: DESKTOP,
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
    locale: 'en-US',
  })
  const page = await ctx.newPage()

  try {
    await page.goto(HOME, { waitUntil: 'domcontentloaded', timeout: 45000 })
    await settle(page, 5000)
    await shot(page, 'S01-home-desktop')
    metrics.home = await measure(page)

    // Browse
    if (await clickNav(page, /^Browse$/)) {
      await shot(page, 'S02-browse-desktop')
      metrics.browse = await measure(page)
    }

    // Radio
    await page.goto(HOME, { waitUntil: 'domcontentloaded' }).catch(() => {})
    await settle(page, 1500)
    if (await clickNav(page, /^Radio$/)) {
      await shot(page, 'S03-radio-desktop')
    }

    // Search
    await page.goto('https://music.apple.com/in/search', { waitUntil: 'domcontentloaded' }).catch(() => {})
    await settle(page, 3000)
    await shot(page, 'S04-search-desktop')
    try {
      const input = page.locator('input[type="search"], input[placeholder*="earch" i]').first()
      if (await input.isVisible({ timeout: 3000 })) {
        await input.fill('daft punk')
        await page.waitForTimeout(2800)
        await shot(page, 'S05-search-results-desktop')
      }
    } catch {
      console.log('search input not found')
    }

    // Album page: click first album link from home
    await page.goto(HOME, { waitUntil: 'domcontentloaded' }).catch(() => {})
    await settle(page, 2500)
    const albumLink = page.locator('a[href*="/album/"]').first()
    if (await albumLink.isVisible({ timeout: 4000 }).catch(() => false)) {
      await albumLink.click()
      await page.waitForTimeout(3200)
      await shot(page, 'S06-album-desktop')
      metrics.album = await measure(page)

      // Artist link on album page
      const artistLink = page.locator('a[href*="/artist/"]').first()
      if (await artistLink.isVisible({ timeout: 2500 }).catch(() => false)) {
        await artistLink.click()
        await page.waitForTimeout(3000)
        await shot(page, 'S07-artist-desktop')
      }
    }

    // Try starting playback from home (play button on an album card)
    await page.goto(HOME, { waitUntil: 'domcontentloaded' }).catch(() => {})
    await settle(page, 2000)
    const playBtn = page.locator('button[aria-label*="Play" i]').first()
    if (await playBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await playBtn.click().catch(() => {})
      await page.waitForTimeout(3500)
      await shot(page, 'S08-player-playing-desktop')
    }

    // Library (may redirect to sign-in — capture whatever appears)
    await page.goto('https://music.apple.com/in/library/recently-added', { waitUntil: 'domcontentloaded' }).catch(() => {})
    await settle(page, 3000)
    await shot(page, 'S09-library-desktop')
  } catch (err) {
    console.error('desktop capture error:', err)
  }

  // ---- Mobile ----
  const mctx = await browser.newContext({
    viewport: MOBILE,
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
    locale: 'en-US',
    isMobile: true,
    hasTouch: true,
  })
  const mp = await mctx.newPage()
  try {
    await mp.goto(HOME, { waitUntil: 'domcontentloaded', timeout: 45000 })
    await settle(mp, 5000)
    await shot(mp, 'S01-home-mobile')
    metrics.homeMobile = await measure(mp)

    const albumLink = mp.locator('a[href*="/album/"]').first()
    if (await albumLink.isVisible({ timeout: 4000 }).catch(() => false)) {
      await albumLink.click()
      await mp.waitForTimeout(3000)
      await shot(mp, 'S06-album-mobile')
    }
  } catch (err) {
    console.error('mobile capture error:', err)
  }

  writeFileSync(join(outDir, 'metrics.json'), JSON.stringify(metrics, null, 2))
  console.log('metrics written')
  await browser.close()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
