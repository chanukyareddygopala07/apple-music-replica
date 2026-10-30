import { defineConfig } from '@playwright/test'

/**
 * E2E against the real FastAPI backend (same-origin /api via the Vite proxy).
 *
 * Deliberately credential-less and offline-deterministic: the backend runs
 * with Audius enabled (it needs no key) and Jamendo/YouTube unconfigured, so
 * the suite can assert the *integration surface* — server-driven source
 * availability, honest unconfigured messages, API-mode search plumbing —
 * without any external provider traffic. Provider content itself is covered
 * by the backend's MockTransport suites and the frontend unit tests.
 */
export default defineConfig({
  testDir: 'tests/e2e-backend',
  timeout: 45_000,
  fullyParallel: false,
  retries: 0,
  use: {
    baseURL: 'http://127.0.0.1:4174',
    locale: 'en-US',
  },
  webServer: [
    {
      command: '.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000',
      cwd: 'backend',
      url: 'http://127.0.0.1:8000/api/health',
      reuseExistingServer: true,
      timeout: 60_000,
      env: {
        AUDIUS_ENABLED: '1', // no key needed → server reports it configured
        JAMENDO_CLIENT_ID: '',
        YOUTUBE_API_KEY: '',
        PROVIDER_REQUEST_GAP_MS: '0',
        LOG_LEVEL: 'warning',
      },
    },
    {
      command: 'npm run build && npm run preview -- --host 127.0.0.1 --port 4174 --strictPort',
      url: 'http://127.0.0.1:4174',
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        ...(process.env as unknown as Record<string, string>),
        // Browser-side providers are off: everything remote must come from the
        // API, which proves the integration rather than the direct fallback.
        VITE_AUDIUS_ENABLED: '0',
        VITE_JAMENDO_CLIENT_ID: '',
        VITE_YOUTUBE_API_KEY: '',
        VITE_API_ENABLED: '1', // same-origin /api via the preview proxy
      },
    },
  ],
})
