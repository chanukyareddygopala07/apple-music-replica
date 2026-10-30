/** History-API router (framework-free). */

/** Deploy base path (`/` locally; e.g. `/apple-music-replica/` on GitHub Pages). */
const BASE: string = import.meta.env.BASE_URL || '/'

function normalizedBase(base: string): string {
  return base === '/' ? '' : base.replace(/\/+$/, '')
}

/** Strip the deploy base prefix from a location pathname (for route parsing). */
export function stripBase(pathname: string, base: string = BASE): string {
  const b = normalizedBase(base)
  if (!b) return pathname
  if (pathname === b) return '/'
  if (pathname.startsWith(b + '/')) return pathname.slice(b.length) || '/'
  return pathname
}

/** Prefix an app-absolute path with the deploy base (for history writes). */
export function withBase(path: string, base: string = BASE): string {
  const b = normalizedBase(base)
  if (!b) return path
  if (path === b || path.startsWith(b + '/')) return path
  if (!path.startsWith('/')) return `${b}/${path}`
  return b + path
}

/**
 * App route for an artist page, or null when the id can't form a valid route.
 * Callers must render non-clickable text instead of an empty `/artist/` link.
 * (Links stay app-absolute; `router.navigate`/link interception applies the base.)
 */
export function artistPath(id: string | null | undefined): string | null {
  const v = (id ?? '').trim()
  if (!v || v === 'undefined' || v === 'null') return null
  return `/artist/${v}`
}

export type Route =
  | { name: 'home' }
  | { name: 'browse' }
  | { name: 'radio' }
  | { name: 'search'; q: string; lang?: string; src?: string }
  | { name: 'library'; tab: string }
  | { name: 'album'; id: string }
  | { name: 'artist'; id: string }
  | { name: 'playlist'; id: string }
  | { name: 'song'; id: string }
  | { name: 'genre'; id: string }
  | { name: 'watch'; id: string }
  | { name: 'now-playing'; panel: 'queue' | 'lyrics' }
  | { name: 'not-found'; path: string }

export function parseLocation(loc: { pathname: string; search?: string }): Route {
  const path = stripBase(loc.pathname).replace(/\/+$/, '') || '/'
  const params = new URLSearchParams(loc.search ?? '')
  if (path === '/') return { name: 'home' }
  if (path === '/browse') return { name: 'browse' }
  if (path === '/radio') return { name: 'radio' }
  if (path === '/search') {
    const route: { name: 'search'; q: string; lang?: string; src?: string } = {
      name: 'search',
      q: params.get('q') ?? '',
    }
    const lang = params.get('lang')
    const src = params.get('src')
    if (lang) route.lang = lang
    if (src) route.src = src
    return route
  }
  if (path === '/library') return { name: 'library', tab: params.get('tab') ?? 'playlists' }
  if (path === '/now-playing') {
    const panel = params.get('panel') === 'queue' ? 'queue' : 'lyrics'
    return { name: 'now-playing', panel }
  }
  const m = /^\/(album|artist|playlist|song|genre)\/([^/]+)$/.exec(path)
  if (m) {
    const kind = m[1]!
    const id = decodeURIComponent(m[2]!)
    if (kind === 'album') return { name: 'album', id }
    if (kind === 'artist') return { name: 'artist', id }
    if (kind === 'playlist') return { name: 'playlist', id }
    if (kind === 'song') return { name: 'song', id }
    return { name: 'genre', id }
  }
  const w = /^\/watch\/([^/]+)$/.exec(path)
  if (w) return { name: 'watch', id: decodeURIComponent(w[1]!) }
  return { name: 'not-found', path }
}

export function routeKey(route: Route): string {
  switch (route.name) {
    case 'search':
      return `search:${route.q}`
    case 'library':
      return `library:${route.tab}`
    case 'album':
      return `album:${route.id}`
    case 'artist':
      return `artist:${route.id}`
    case 'playlist':
      return `playlist:${route.id}`
    case 'song':
      return `song:${route.id}`
    case 'genre':
      return `genre:${route.id}`
    case 'watch':
      return `watch:${route.id}`
    case 'now-playing':
      return `now-playing:${route.panel}`
    default:
      return route.name
  }
}

export interface Router {
  current(): Route
  navigate(href: string, opts?: { replace?: boolean }): void
  back(): void
  start(onChange: (route: Route) => void): void
  setRouteTitle(title: string): void
}

export function createRouter(): Router {
  let change: ((route: Route) => void) | null = null
  const current = (): Route => parseLocation(window.location)

  const emit = () => change?.(current())

  return {
    current,
    navigate(href, opts) {
      const url = new URL(href, window.location.origin)
      const next = withBase(url.pathname) + url.search
      if (opts?.replace) window.history.replaceState(null, '', next)
      else window.history.pushState(null, '', next)
      emit()
    },
    back() {
      window.history.back()
    },
    start(onChange) {
      change = onChange
      window.addEventListener('popstate', emit)
      emit()
    },
    setRouteTitle(title) {
      document.title = title ? `${title} — Realaxify` : 'Realaxify'
    },
  }
}

/** Intercept clicks on [data-nav] anchors so the SPA router handles them. */
export function bindLinkInterception(root: HTMLElement, router: Router): () => void {
  const handler = (ev: MouseEvent) => {
    if (ev.defaultPrevented || ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return
    const anchor = (ev.target as Element | null)?.closest?.('a[data-nav], a[href^="/"]') as HTMLAnchorElement | null
    if (!anchor || !root.contains(anchor)) return
    const href = anchor.getAttribute('href')
    if (!href || !href.startsWith('/') || href.startsWith('//')) return
    ev.preventDefault()
    router.navigate(href)
  }
  root.addEventListener('click', handler)
  return () => root.removeEventListener('click', handler)
}
