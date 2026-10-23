import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 45_000,
  fullyParallel: true,
  retries: 0,
  use: {
    baseURL: 'http://127.0.0.1:4173',
    locale: 'en-US',
  },
  webServer: {
    command: 'npm run build && npm run preview -- --host 127.0.0.1 --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: true,
    timeout: 120_000,
    env: {
      // Deterministic, credential-less e2e: Audius (default-on provider) is
      // disabled for the test build so the suite never depends on the live
      // API. Provider behaviour itself is covered by unit tests.
      ...(process.env as unknown as Record<string, string>),
      VITE_AUDIUS_ENABLED: '0',
    },
  },
})
