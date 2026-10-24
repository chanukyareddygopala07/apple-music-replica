import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
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
  await expect(page.locator('.app-layout .sidebar-brand')).toContainText('Sonora')
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
  await expect(page.locator('.search-notice')).toContainText('Sonora Demo')
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
