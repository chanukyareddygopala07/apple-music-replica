import { expect, test } from '@playwright/test'

// Minimal 16-bit PCM mono WAV: ~2 min of silence at 8 kHz (≈1.9 MB buffer).
// Demo audio streams from soundhelix.com; under parallel load the real
// network fetch keeps the player in `loading` longer than the assertions
// allow, so we fulfil it locally for deterministic playback state.
const SILENT_WAV = (() => {
  const sampleRate = 8_000
  const seconds = 120
  const samples = sampleRate * seconds
  const dataSize = samples * 2
  const buf = Buffer.alloc(44 + dataSize)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + dataSize, 4)
  buf.write('WAVE', 8)
  buf.write('fmt ', 12)
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20) // PCM
  buf.writeUInt16LE(1, 22) // mono
  buf.writeUInt32LE(sampleRate, 24)
  buf.writeUInt32LE(sampleRate * 2, 28) // byte rate
  buf.writeUInt16LE(2, 32) // block align
  buf.writeUInt16LE(16, 34) // bits per sample
  buf.write('data', 36)
  buf.writeUInt32LE(dataSize, 40)
  return buf
})()

test.beforeEach(async ({ page }) => {
  await page.route('**soundhelix.com/**', (route) =>
    route.fulfill({ body: SILENT_WAV, contentType: 'audio/wav' }),
  )
  await page.addInitScript(() => {
    // Clear once per test (sessionStorage survives client+full navigations in the same tab)
    if (!sessionStorage.getItem('e2e-init')) {
      localStorage.clear()
      sessionStorage.setItem('e2e-init', '1')
    }
  })
})

test('home renders shell, editorial feed and song rows', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Home', level: 1 })).toBeVisible()
  await expect(page.locator('.app-layout .sidebar-brand')).toContainText('Realaxify')
  await expect(page.locator('.editorial-card').first()).toBeVisible()
  await expect(page.locator('.song-row').first()).toBeVisible()
})

test('navigates between main sections', async ({ page }) => {
  await page.goto('/')
  await page.locator('.app-layout .sidebar a[data-nav-href="/browse"]').click()
  await expect(page).toHaveURL(/\/browse$/)
  await expect(page.getByRole('heading', { name: 'Browse', level: 1 })).toBeVisible()

  await page.locator('.app-layout .sidebar a[data-nav-href="/radio"]').click()
  await expect(page).toHaveURL(/\/radio$/)

  await page.locator('.app-layout .sidebar a[data-nav-href="/library"]').click()
  await expect(page).toHaveURL(/\/library/)
})

test('search returns grouped results for a catalogue term', async ({ page }) => {
  await page.goto('/search')
  await page.fill('#search-input', 'harbor')
  await expect(page.locator('.top-result, .list-rows .song-row').first()).toBeVisible({ timeout: 10_000 })
})

test('search filters default to all and sync language/source with the URL', async ({ page }) => {
  await page.goto('/search?q=harbor')
  const language = page.locator('#search-language')
  const source = page.locator('#search-source')
  await expect(language).toHaveValue('all')
  await expect(source).toHaveValue('all')

  // The e2e build is demo-only, and the demo catalogue is English-only, so a
  // French search honestly hides it instead of returning English matches.
  await language.selectOption('fr')
  await expect(page).toHaveURL(/lang=fr/)
  await expect(page.locator('.search-notice')).toContainText('Realaxify Demo')
  await expect(page.locator('#search-body .state-block')).toBeVisible()

  await source.selectOption('demo')
  await expect(page).toHaveURL(/src=demo/)

  await page.reload()
  await expect(language).toHaveValue('fr')
  await expect(source).toHaveValue('demo')
})

test('album page plays a track and shows the player bar', async ({ page }) => {
  await page.goto('/album/al-tidal-lines')
  await expect(page.getByRole('heading', { name: 'Tidal Lines' })).toBeVisible()
  await page.locator('.song-row').first().click()
  const bar = page.locator('.player-bar')
  await expect(bar).toBeVisible()
  await expect(bar.locator('.pl-title')).toContainText('Harbor Lights')
  // pause / resume via transport
  await bar.locator('[data-action="toggle-play"]').click()
  await expect(bar.locator('[data-action="toggle-play"]')).toHaveAttribute('aria-label', 'Play')
})

test('playback survives navigation; queue panel lists upcoming tracks', async ({ page }) => {
  await page.goto('/album/al-tidal-lines')
  await page.locator('.song-row').nth(1).click()
  await expect(page.locator('.player-bar .pl-title')).toContainText('Tidal Lines')

  await page.locator('.app-layout .sidebar a[data-nav-href="/browse"]').click()
  await expect(page.locator('.player-bar')).toBeVisible()
  await expect(page.locator('.player-bar .pl-title')).toContainText('Tidal Lines')

  await page.locator('.player-bar a[aria-label="Playing Next"]').click()
  await expect(page).toHaveURL(/now-playing\?panel=queue/)
  await expect(page.locator('.queue-row').first()).toBeVisible()
  await expect(page.locator('.queue-row')).toHaveCount(4)
})

test('favorite a song from the song menu and see it in Library', async ({ page }) => {
  await page.goto('/album/al-tidal-lines')
  const row = page.locator('.song-row').first()
  await row.locator('[data-action="song-menu"]').click()
  await page.locator('.menu-item', { hasText: 'Favorite' }).click()
  // heart button on the row reflects state after redraw via menu only; check store through UI:
  await page.goto('/library?tab=songs')
  await expect(page.locator('.song-row', { hasText: 'Harbor Lights' }).first()).toBeVisible()
})

test('create a playlist from the sidebar and add a song to it', async ({ page }) => {
  await page.goto('/')
  await page.locator('[data-action="new-playlist"]').first().click()
  await page.locator('dialog input[name="title"]').fill('Evening Drive')
  await page.locator('dialog button[type="submit"], dialog .btn-primary').click()
  await expect(page).toHaveURL(/\/playlist\/user-/)
  await expect(page.getByRole('heading', { name: 'Evening Drive' })).toBeVisible()

  await page.goto('/album/al-marigold')
  await page.locator('.song-row').first().locator('[data-action="song-menu"]').click()
  await page.locator('.menu-item', { hasText: 'Add to Playlist' }).click()
  await page.locator('dialog input[name="target"]').fill('Evening Drive')
  await page.locator('dialog button[type="submit"], dialog .btn-primary').click()
  await page.goto('/library?tab=playlists')
  await expect(page.locator('a, .card-title, .media-card', { hasText: 'Evening Drive' }).first()).toBeVisible()
})

test('search view category grid links to a genre page', async ({ page }) => {
  await page.goto('/search')
  await page.locator('.category-card').first().click()
  await expect(page).toHaveURL(/\/genre\//)
  await expect(page.locator('.song-row, .media-card').first()).toBeVisible()
})

test('keyboard shortcut / focuses search', async ({ page }) => {
  await page.goto('/')
  await page.keyboard.press('/')
  await expect(page).toHaveURL(/\/search/)
  await expect(page.locator('#search-input')).toBeFocused()
})

test('top search input draws a visible focus ring (WCAG 2.4.7)', async ({ page }) => {
  await page.goto('/')
  const input = page.locator('#top-search-input')
  await input.focus()
  await expect(input).toBeFocused()
  const ring = await input.evaluate((el) => {
    const s = getComputedStyle(el)
    return { style: s.outlineStyle, width: s.outlineWidth, color: s.outlineColor }
  })
  expect(ring.style).toBe('solid')
  expect(ring.width).toBe('2px')
  expect(ring.color).not.toBe('rgba(0, 0, 0, 0)')
})

test('unknown route shows not-found', async ({ page }) => {
  await page.goto('/definitely-not-a-page')
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible()
})

test('credential-less build never contacts MusicKit and keeps the demo search path', async ({ page }) => {
  const musicKitRequests: string[] = []
  page.on('request', (req) => {
    const url = req.url()
    if (url.includes('music.apple.com') || url.includes('musickit')) musicKitRequests.push(url)
  })

  // Home + search (the only view that consults the catalogue providers).
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Home', level: 1 })).toBeVisible()
  await page.goto('/search')
  await page.fill('#search-input', 'harbor')
  await expect(page.locator('.top-result, .list-rows .song-row').first()).toBeVisible({ timeout: 10_000 })

  expect(musicKitRequests).toEqual([])
  const musicKitGlobal = await page.evaluate(() => typeof (window as unknown as { MusicKit?: unknown }).MusicKit)
  expect(musicKitGlobal).toBe('undefined')
  const cdnScripts = await page.locator('script[src*="music.apple.com"]').count()
  expect(cdnScripts).toBe(0)
})

test('YouTube is not offered as a source until an API key is configured', async ({ page }) => {
  await page.goto('/search?q=harbor')
  await expect(page.locator('#search-source option[value="youtube"]')).toHaveCount(0)
  // All-sources results never contain YouTube rows in a keyless build.
  await expect(page.locator('.top-result, .list-rows .song-row').first()).toBeVisible({ timeout: 10_000 })
  await expect(page.locator('.song-row[data-song-id^="yt-"]')).toHaveCount(0)
})

test('explicit ?src=youtube on a keyless build shows the setup notice and never calls googleapis', async ({ page }) => {
  const googleRequests: string[] = []
  page.on('request', (req) => {
    if (req.url().includes('googleapis.com')) googleRequests.push(req.url())
  })
  await page.route('**googleapis.com/**', (route) => route.abort())

  await page.goto('/search?q=harbor&src=youtube')
  await expect(page.locator('#search-source')).toHaveValue('youtube')
  await expect(page.locator('.search-notice')).toContainText('VITE_YOUTUBE_API_KEY', { timeout: 10_000 })
  await expect(page.locator('#search-body .state-block')).toBeVisible()
  expect(googleRequests).toEqual([])
})

test('watch with an invalid id shows the honest error state', async ({ page }) => {
  await page.goto('/watch/not-a-video')
  await expect(page.locator('#yt-watch-host')).toContainText('Invalid video')
  await expect(page.locator('#watch-sub')).toHaveText('')
})

test('keyless watch falls back to the official YouTube link and never contacts googleapis', async ({ page }) => {
  const googleRequests: string[] = []
  page.on('request', (req) => {
    if (req.url().includes('googleapis.com')) googleRequests.push(req.url())
  })
  // Deterministic offline behaviour: block the Data API (must never be hit)
  // and both embed hosts (iframe API load fails → honest fallback).
  await page.route('**googleapis.com/**', (route) => route.abort())
  await page.route('**www.youtube.com/**', (route) => route.abort())
  await page.route('**www.youtube-nocookie.com/**', (route) => route.abort())

  await page.goto('/watch/yt-dQw4w9WgXcQ')
  // Keyless: the metadata lookup is skipped entirely (zero Data API calls).
  await expect(page.locator('#watch-sub')).toContainText('YouTube video')
  await expect(page.locator('#yt-watch-host a', { hasText: 'Watch on YouTube' })).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('#watch-status')).toContainText('Player unavailable')
  await expect(page.locator('#watch-foot')).toContainText('YouTube Terms of Service')
  expect(googleRequests).toEqual([])
})

test('opening /watch pauses the audio engine; leaving destroys the embed', async ({ page }) => {
  await page.route('**www.youtube.com/**', (route) => route.abort())
  await page.route('**www.youtube-nocookie.com/**', (route) => route.abort())

  await page.goto('/album/al-tidal-lines')
  await page.locator('.song-row').first().click()
  const bar = page.locator('.player-bar')
  await expect(bar.locator('[data-action="toggle-play"]')).toHaveAttribute('aria-label', 'Pause')

  // Client-side navigation to /watch (no yt rows exist in a keyless build).
  await page.evaluate(() => {
    window.history.pushState(null, '', '/watch/yt-dQw4w9WgXcQ')
    window.dispatchEvent(new PopStateEvent('popstate'))
  })
  await expect(page).toHaveURL(/\/watch\/yt-dQw4w9WgXcQ/)
  await expect(page.getByRole('heading', { name: 'YouTube', level: 1 })).toBeVisible()
  // Two sound sources can never overlap: the <audio> engine is paused.
  await expect(bar.locator('[data-action="toggle-play"]')).toHaveAttribute('aria-label', 'Play')
  await expect(page.locator('#watch-status')).toContainText('Player unavailable', { timeout: 15_000 })

  // Leaving the route destroys the embed (shell hook) — no live YouTube iframe.
  await page.locator('.app-layout .sidebar a[data-nav-href="/browse"]').click()
  await expect(page).toHaveURL(/\/browse$/)
  await expect(page.locator('#yt-watch-host')).toHaveCount(0)
  await expect(page.locator('iframe[src*="youtube"]')).toHaveCount(0)
})

test('home shows Explore by Language absent and YouTube Music not-connected when keyless', async ({ page }) => {
  await page.goto('/')

  // Keyless build: the YouTube section header is always visible and shows
  // the honest not-connected state (never a spinner forever, never fake cards).
  await expect(page.getByRole('heading', { name: 'YouTube Music', level: 2 })).toBeVisible()
  await expect(page.locator('[data-yt-section] .state-title')).toHaveText('YouTube search is not connected', {
    timeout: 15_000,
  })
  await expect(page.locator('[data-yt-section] .state-desc')).toContainText('VITE_YOUTUBE_API_KEY')
  await expect(page.locator('[data-yt-section] .yt-card')).toHaveCount(0)
  await expect(page.locator('[data-yt-section] [data-action="home-discovery-retry"]')).toHaveCount(0)

  // The demo-only feed carries no mappable languages → the section is absent.
  await expect(page.locator('[data-lang-section] .section-title')).toHaveCount(0)
  await expect(page.locator('section.lang-shelf')).toHaveCount(0)
})

test('home discovery sections fit a 390px viewport without page overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')

  // Wait until discovery settled (honest state under the YouTube header).
  await expect(page.locator('[data-yt-section] .state-title, [data-yt-section] .yt-card').first()).toBeVisible({
    timeout: 15_000,
  })
  await expect(page.locator('[data-yt-section] .section-title')).toBeVisible()
  await expect(page.locator('.song-row').first()).toBeVisible()

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBeLessThanOrEqual(1)
})

test('now rail lists the queue and marks the current row while playing', async ({ page }) => {
  await page.goto('/album/al-tidal-lines')
  await page.locator('.song-row').first().click()

  const rail = page.locator('.side-rail')
  await expect(rail).toBeVisible()
  await expect(rail.locator('.rail-title')).toHaveText('Now playing')
  await expect(rail.locator('.song-row').first()).toHaveAttribute('data-song-id', 's-tl-1')
  await expect(rail.locator('.song-row.is-current')).toHaveCount(1)
  await expect(rail.locator('.song-row.is-current')).toHaveAttribute('data-song-id', 's-tl-1')
  // Equalizer overlay only runs while playback is actually running.
  await expect(rail.locator('.eq-bars')).toHaveCount(1)
  await expect(rail).toHaveAttribute('data-playing', 'true')
  await expect(rail.locator('.rail-view-all')).toBeVisible()

  // Pause: the rail stops animating (real state, no fake timers).
  await page.locator('.player-bar [data-action="toggle-play"]').click()
  await expect(rail.locator('.eq-bars')).toHaveCount(1) // still present
  await expect(rail).toHaveAttribute('data-playing', 'false')
})

test('top-bar search navigates to results', async ({ page }) => {
  await page.goto('/')
  await page.fill('#top-search-input', 'harbor')
  await page.locator('[data-top-search]').press('Enter')
  await expect(page).toHaveURL(/\/search\?q=harbor/)
  // The search view's own input reflects the query (page title stays "Search").
  await expect(page.locator('#search-input')).toHaveValue('harbor')
  await expect(page.getByRole('heading', { name: 'Search', level: 1 })).toBeVisible()
})

test('route changes are skipped entirely under prefers-reduced-motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')

  // View wipe + stagger must not be applied (matches the media query contract).
  await page.locator('.app-layout .sidebar a[data-nav-href="/browse"]').click()
  await expect(page).toHaveURL(/\/browse$/)
  const leaving = await page.locator('.view-leaving').count()
  const entering = await page.locator('.view-enter').count()
  expect(leaving).toBe(0)
  expect(entering).toBe(0)

  // Heading reveal still keeps the accessible name.
  await expect(page.getByRole('heading', { name: 'Browse', level: 1 })).toBeVisible()
})

test('heading reveal keeps the accessible name and text content', async ({ page }) => {
  await page.goto('/')
  const h1 = page.getByRole('heading', { name: 'Home', level: 1 })
  await expect(h1).toBeVisible()
  // Per-char split keeps plain textContent identical for tooling/tests.
  const text = await h1.evaluate((el) => el.textContent ?? '')
  expect(text).toBe('Home')
})

test('route lifecycle: outgoing view is inerted and stripped of IDs; staging is inert until commit', async ({ page }) => {
  await page.goto('/search?q=harbor')
  await expect(page.locator('#search-input')).toBeVisible()

  // Click and probe in ONE evaluate call: the handler's synchronous prefix
  // (inert + ID strip + staging slot) runs during a.click(), so the mid-transition
  // DOM is observable before any round-trip lets the 200ms wipe commit.
  const mid = await page.evaluate(() => {
    document.querySelector<HTMLAnchorElement>('a[data-nav-href="/browse"]')!.click()
    const host = document.querySelector('[data-view-host]')!
    const slots = [...host.querySelectorAll(':scope > .view-slot')]
    return {
      slotCount: slots.length,
      inertCount: slots.filter((s) => s.hasAttribute('inert')).length,
      stagingCount: slots.filter((s) => s.classList.contains('is-staging')).length,
      leftoverIds: document.querySelectorAll('#search-input, #search-body, #search-language, #search-source')
        .length,
    }
  })
  // Dying search view: inert + IDs stripped. Incoming browse: inert + staging.
  expect(mid.slotCount).toBe(2)
  expect(mid.inertCount).toBe(2)
  expect(mid.stagingCount).toBe(1)
  expect(mid.leftoverIds).toBe(0)

  // After commit: exactly one live slot, no inert, no staging. Heading
  // visibility alone is not a commit signal — the staged heading is already
  // "visible" to Playwright (opacity 0 still has a bounding box), so wait
  // for the dying slot to be dropped first.
  await expect(page.locator('[data-view-host] > .view-slot')).toHaveCount(1)
  await expect(page.getByRole('heading', { name: 'Browse', level: 1 })).toBeVisible()
  const after = await page.evaluate(() => {
    const host = document.querySelector('[data-view-host]')!
    const slots = [...host.querySelectorAll(':scope > .view-slot')]
    return {
      slotCount: slots.length,
      inertCount: slots.filter((s) => s.hasAttribute('inert')).length,
      stagingCount: slots.filter((s) => s.classList.contains('is-staging')).length,
    }
  })
  expect(after).toEqual({ slotCount: 1, inertCount: 0, stagingCount: 0 })
})

test('rapid navigation settles on the last route with a single live slot', async ({ page }) => {
  await page.goto('/')
  // Two client-side navigations in one task: the first render is superseded.
  await page.evaluate(() => {
    document.querySelector<HTMLAnchorElement>('a[data-nav-href="/browse"]')?.click()
    document.querySelector<HTMLAnchorElement>('a[data-nav-href="/library"]')?.click()
  })
  await expect(page).toHaveURL(/\/library/)
  await expect(page.getByRole('heading', { name: 'Library', level: 1 })).toBeVisible()
  await expect(page.locator('[data-view-host] > .view-slot')).toHaveCount(1)
  await expect(page.locator('[data-view-host] > .view-slot[inert]')).toHaveCount(0)
  // The superseded Browse view is fully gone, not merely hidden.
  await expect(page.getByRole('heading', { name: 'Browse', level: 1 })).toHaveCount(0)
})

test('search → search never leaves duplicate element IDs', async ({ page }) => {
  await page.goto('/search?q=harbor')
  await expect(page.locator('#search-input')).toHaveValue('harbor')

  await page.fill('#top-search-input', 'tidal')
  await page.locator('[data-top-search]').press('Enter')
  await expect(page).toHaveURL(/\/search\?q=tidal/)
  await expect(page.locator('#search-input')).toHaveValue('tidal')

  const duplicates = await page.evaluate(() => {
    const counts = new Map<string, number>()
    document.querySelectorAll('[id]').forEach((el) => counts.set(el.id, (counts.get(el.id) ?? 0) + 1))
    return [...counts.entries()].filter(([, n]) => n > 1).map(([id]) => id)
  })
  expect(duplicates).toEqual([])
})

test('tab focus never lands in a staging or removed view during transitions', async ({ page }) => {
  await page.goto('/search?q=harbor')
  await expect(page.locator('#search-input')).toBeVisible()

  // Click + probe in ONE evaluate: observes the exact mid-transition window
  // (the 200ms wipe cannot commit while the probe runs — same task).
  const focusProbe = await page.evaluate(() => {
    document.querySelector<HTMLAnchorElement>('a[data-nav-href="/browse"]')!.click()
    const host = document.querySelector('[data-view-host]')!
    const committed = host.querySelector<HTMLElement>(':scope > .view-slot:not(.is-staging)')
    return {
      // Mid-transition the only non-staging slot in the host is the dying
      // search view — inert removes it from the tab order entirely.
      committedIsNull: committed === null,
      committedIsInert: committed?.hasAttribute('inert') ?? false,
      stagingIsInert:
        host.querySelector(':scope > .view-slot.is-staging')?.hasAttribute('inert') ?? false,
    }
  })
  expect(focusProbe.committedIsNull || focusProbe.committedIsInert).toBe(true)
  expect(focusProbe.stagingIsInert).toBe(true)

  // After commit, focus works in the new view again. Wait for the commit
  // itself (dying slot dropped) — the staged heading is already "visible"
  // to Playwright before the wipe finishes.
  await expect(page.locator('[data-view-host] > .view-slot')).toHaveCount(1)
  await expect(page.getByRole('heading', { name: 'Browse', level: 1 })).toBeVisible()
  const postCommit = await page.evaluate(() => {
    const committed = document.querySelector<HTMLElement>('[data-view-host] > .view-slot:not(.is-staging)')
    return {
      exists: committed !== null,
      inert: committed?.hasAttribute('inert') ?? null,
    }
  })
  expect(postCommit).toEqual({ exists: true, inert: false })
})
