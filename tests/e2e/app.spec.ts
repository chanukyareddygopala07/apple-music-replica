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
