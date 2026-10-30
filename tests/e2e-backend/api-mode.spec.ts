import { expect, test } from '@playwright/test'

/**
 * API-mode integration: the static frontend talking to the FastAPI backend
 * on the same origin. See playwright.backend.config.ts for the topology —
 * no external providers are contacted by these tests.
 */

test('the backend answers /api/health on the app origin', async ({ request }) => {
  const response = await request.get('/api/health')
  expect(response.ok()).toBeTruthy()
  const body = (await response.json()) as { status: string; providers: Array<{ id: string }> }
  expect(body.status).toBe('ok')
  expect(body.providers.map((p) => p.id)).toEqual(['audius', 'jamendo', 'youtube'])
})

test('the source selector offers a source configured only on the server', async ({ page }) => {
  // Browser build has VITE_AUDIUS_ENABLED=0 — Audius can only appear if the
  // server reported it configured via /api/providers.
  await page.goto('/search?q=harbor')
  await expect(page.locator('#search-source option[value="audius"]')).toHaveCount(1)
  await expect(page.locator('#search-source option[value="demo"]')).toHaveCount(1)
})

test('demo search still works with no browser-side provider keys', async ({ page }) => {
  await page.goto('/search?q=harbor')
  await expect(page.locator('#search-input')).toHaveValue('harbor')
  // Demo results render (client-side catalogue), proving the app never
  // depends on the API for its local content.
  await expect(page.getByText(/Harbor/i).first()).toBeVisible({ timeout: 10_000 })
})

test('unconfigured server sources are not offered, and setup notices stay honest', async ({ page }) => {
  await page.goto('/search?q=harbor')
  // Neither is configured on the server or in the browser build.
  await expect(page.locator('#search-source option[value="jamendo"]')).toHaveCount(0)
  await expect(page.locator('#search-source option[value="youtube"]')).toHaveCount(0)
  // The dedicated YouTube view still explains exactly what is missing.
  await page.goto('/search?q=harbor&src=youtube')
  await expect(page.getByText(/YOUTUBE_API_KEY/).first()).toBeVisible({ timeout: 10_000 })
})

test('the Settings dialog lists the server-reported provider status', async ({ page }) => {
  await page.goto('/')
  await page.locator('[data-action="settings"]').first().click()
  await expect(page.getByText('Catalogue providers')).toBeVisible()
  // Audius is configured on the server (no key required); Jamendo is not.
  await expect(page.getByText(/Audius: configured/)).toBeVisible()
  await expect(page.getByText(/Jamendo: off/)).toBeVisible()
})
