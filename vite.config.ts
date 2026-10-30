import { defineConfig } from 'vite'
import { fileURLToPath, URL } from 'node:url'

/**
 * Local `/api` proxy to the FastAPI backend (backend/). Enabled only when the
 * app calls the API same-origin (`VITE_API_BASE` unset); set `VITE_API_BASE`
 * to point at a deployed API instead. `VITE_API_PROXY` overrides the target
 * and `VITE_API_PROXY=off` disables proxying entirely.
 */
const apiProxyTarget = process.env.VITE_API_BASE
  ? undefined
  : process.env.VITE_API_PROXY === 'off'
    ? undefined
    : (process.env.VITE_API_PROXY ?? 'http://127.0.0.1:8000')

const apiProxy = apiProxyTarget
  ? { '/api': { target: apiProxyTarget, changeOrigin: true } }
  : undefined

export default defineConfig({
  appType: 'spa',
  // VITE_BASE lets the GitHub Pages workflow build under a subpath;
  // local dev and preview keep the default '/'.
  base: process.env.VITE_BASE ?? '/',
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: apiProxy,
  },
  preview: {
    port: 4173,
    strictPort: true,
    proxy: apiProxy,
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
})
