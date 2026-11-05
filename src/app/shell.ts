/** App shell: sidebar, mobile chrome, view host, player bar, now-playing overlay, keyboard. */

import { bindLinkInterception, stripBase, type Route } from '@/app/router'
import { router as sharedRouter } from '@/app/router-bridge'
import { player } from '@/engine/player'
import { getCatalog, registerDemoIndexIntoEngine, songById } from '@/data/catalog-helpers'
import { libraryStore, recordPlayed, createPlaylist } from '@/state/library-store'
import { prefsStore, saveSession, type ThemePref } from '@/state/prefs-store'
import { icon, type IconName } from '@/ui/icons'
import { on, qs } from '@/ui/el'
import { openFormDialog } from '@/ui/dialog'
import { createPlayerBar } from '@/ui/player-bar'
import { createNowRail } from '@/ui/now-rail'
import { revealHeading, staggerView, prefersReducedMotion } from '@/ui/reveal'
import { createNowPlaying } from '@/views/now-playing'
import { bindGlobalActions } from '@/app/actions'
import { renderHome } from '@/views/home'
import { renderBrowse } from '@/views/browse'
import { renderRadio } from '@/views/radio'
import { renderSearch } from '@/views/search'
import { renderLibrary } from '@/views/library'
import { renderAlbum } from '@/views/album'
import { renderArtist } from '@/views/artist'
import { renderPlaylist } from '@/views/playlist'
import { renderSong } from '@/views/song'
import { renderGenre } from '@/views/genre'
import { renderWatch } from '@/views/watch'
import { renderNotFound } from '@/views/not-found'
import { destroyYouTubeEmbed } from '@/ui/youtube-embed'
import { showToast } from '@/ui/toast'

const NAV: Array<{ href: string; label: string; icon: IconName }> = [
  { href: '/', label: 'Home', icon: 'home' },
  { href: '/browse', label: 'Browse', icon: 'browse' },
  { href: '/radio', label: 'Radio', icon: 'radio' },
  { href: '/library', label: 'Library', icon: 'library' },
]

function navItemHtml(item: { href: string; label: string; icon: IconName }): string {
  return `<a class="nav-item" href="${item.href}" data-nav data-nav-href="${item.href}">${icon(item.icon)}<span>${item.label}</span></a>`
}

const BRAND_LOGO_SRC = `${import.meta.env.BASE_URL}realaxify-logo.png`
const BRAND_MARK_SRC = `${import.meta.env.BASE_URL}realaxify-mark.png`

function sidebarHtml(): string {
  return `
    <nav class="sidebar" aria-label="Main">
      <div class="sidebar-brand">
        <img class="brand-logo" src="${BRAND_LOGO_SRC}" alt="" width="1163" height="283" />
        <span class="sr-only">Realaxify</span>
      </div>
      <div class="sidebar-search">
        <a class="nav-item" href="/search" data-nav data-nav-href="/search">${icon('search')}<span>Search</span></a>
      </div>
      <div class="sidebar-nav">
        ${NAV.map(navItemHtml).join('')}
      </div>
      <div class="sidebar-section">
        <div class="sidebar-section-label">Library</div>
        <button type="button" class="nav-item" data-action="new-playlist">${icon('plus')}<span>New Playlist…</span></button>
        <div data-playlist-nav></div>
      </div>
      <div class="sidebar-spacer"></div>
      <div class="sidebar-footer">
        <button type="button" class="nav-item" data-action="cycle-theme">${icon('sun')}<span>Appearance</span></button>
        <button type="button" class="nav-item" data-action="settings">${icon('info')}<span>About & Settings</span></button>
      </div>
    </nav>`
}

function mobileChromeHtml(): string {
  const tabs = [
    { href: '/', label: 'Home', icon: 'home' as IconName },
    { href: '/browse', label: 'Browse', icon: 'browse' as IconName },
    { href: '/radio', label: 'Radio', icon: 'radio' as IconName },
    { href: '/library', label: 'Library', icon: 'library' as IconName },
  ]
  return `
    <header class="mobile-topbar">
      <button type="button" class="icon-btn" data-action="open-drawer" aria-label="Open menu">${icon('menu')}</button>
      <div class="brand">
        <img class="brand-mark-img" src="${BRAND_MARK_SRC}" alt="Realaxify" width="310" height="278" />
      </div>
      <a class="icon-btn" href="/search" data-nav aria-label="Search">${icon('search')}</a>
    </header>
    <div class="mobile-scrim" data-drawer-scrim hidden></div>
    <aside class="mobile-drawer" data-drawer aria-label="Menu" data-open="false">${sidebarHtml()}</aside>
    <nav class="mobile-tabs" aria-label="Sections">
      ${tabs
        .map(
          (t) =>
            `<a class="mobile-tab" href="${t.href}" data-nav data-nav-href="${t.href}">${icon(t.icon)}<span>${t.label}</span></a>`,
        )
        .join('')}
    </nav>`
}

export interface Shell {
  router: typeof sharedRouter
  destroy(): void
}

export function startShell(root: HTMLElement): Shell {
  root.classList.add('app-root')
  root.innerHTML = `
    <div class="app-frame">
      <div class="app-layout">
        ${sidebarHtml()}
        <main class="app-main" id="main-content">
          <div class="view-scroll" data-view-host></div>
        </main>
      </div>
      <header class="top-bar">
        <div class="top-search-cell">
          <form class="top-search" role="search" data-top-search>
            ${icon('search')}
            <label class="sr-only" for="top-search-input">Search music</label>
            <input id="top-search-input" type="search" name="q" placeholder="Search" autocomplete="off" />
          </form>
        </div>
        <div class="user-chip-cell">
          <button type="button" class="user-chip" data-action="settings" aria-label="Account and settings">
            <span>Listener</span>
            <span class="chip-avatar" aria-hidden="true">${icon('sparkle')}</span>
          </button>
        </div>
      </header>
      <div data-player-slot></div>
    </div>
    ${mobileChromeHtml()}
    <div data-np-slot></div>`

  const host = qs<HTMLElement>('[data-view-host]', root)!
  const playerBar = createPlayerBar(player)
  qs<HTMLElement>('[data-player-slot]', root)!.appendChild(playerBar.el)
  playerBar.el.hidden = true

  // Right rail: reference "Now playing" queue column (grid column 3).
  const rail = createNowRail(player)
  qs<HTMLElement>('.app-layout', root)!.appendChild(rail.el)

  const nowPlaying = createNowPlaying(player, () => {
    if (window.history.length > 1) sharedRouter.back()
    else sharedRouter.navigate('/')
  })
  qs<HTMLElement>('[data-np-slot]', root)!.appendChild(nowPlaying.el)

  const unsubs: Array<() => void> = []

  /* ---------- theme ---------- */
  const media = window.matchMedia('(prefers-color-scheme: dark)')
  const applyTheme = (pref: ThemePref): void => {
    const resolved = pref === 'system' ? (media.matches ? 'dark' : 'light') : pref
    document.documentElement.dataset['theme'] = resolved
  }
  applyTheme(prefsStore.get().theme)
  unsubs.push(
    prefsStore.subscribe((p) => applyTheme(p.theme)),
    () => media.removeEventListener('change', onSchemeChange),
  )
  const onSchemeChange = (): void => applyTheme(prefsStore.get().theme)
  media.addEventListener('change', onSchemeChange)

  unsubs.push(
    on(root, 'click', '[data-action="cycle-theme"]', () => {
      const order: ThemePref[] = ['system', 'light', 'dark']
      const cur = prefsStore.get().theme
      const next = order[(order.indexOf(cur) + 1) % order.length]!
      prefsStore.set((p) => ({ ...p, theme: next }))
      showToast({ message: `Appearance: ${next}`, durationMs: 1500 })
    }),
  )

  /* ---------- sidebar playlist nav ---------- */
  const playlistNav = qs<HTMLElement>('[data-playlist-nav]', root)
  const drawPlaylistNav = (): void => {
    if (!playlistNav) return
    const pls = libraryStore.get().playlists
    playlistNav.innerHTML = pls
      .map(
        (p) =>
          `<a class="nav-item" href="/playlist/${p.id}" data-nav data-nav-href="/playlist/${p.id}">${icon('library')}<span class="truncate">${p.title.replaceAll('<', '&lt;')}</span></a>`,
      )
      .join('')
    markActiveNav()
  }
  unsubs.push(libraryStore.subscribe(drawPlaylistNav))
  drawPlaylistNav()

  unsubs.push(
    on(root, 'click', '[data-action="new-playlist"]', () => {
      openFormDialog({
        title: 'New Playlist',
        fields: [{ name: 'title', label: 'Name', type: 'text', required: true, maxLength: 60 }],
        submitLabel: 'Create',
        onSubmit: (values) => {
          if (!values['title']) return 'Please enter a name.'
          const pl = createPlaylist(values['title']!)
          showToast({ message: `Created “${pl.title}”` })
          sharedRouter.navigate(`/playlist/${pl.id}`)
          return null
        },
      })
    }),
  )

  /* ---------- drawer ---------- */
  const drawer = qs<HTMLElement>('[data-drawer]', root)
  const scrim = qs<HTMLElement>('[data-drawer-scrim]', root)
  const setDrawer = (open: boolean): void => {
    drawer?.setAttribute('data-open', String(open))
    if (scrim) {
      scrim.hidden = !open
      scrim.setAttribute('data-open', String(open))
    }
  }
  unsubs.push(
    on(root, 'click', '[data-action="open-drawer"]', () => setDrawer(true)),
    on(root, 'click', '[data-drawer-scrim]', () => setDrawer(false)),
    on(root, 'click', '.mobile-drawer a[data-nav]', () => setDrawer(false)),
  )

  /* ---------- top-bar search ---------- */
  unsubs.push(
    on(root, 'submit', '[data-top-search]', (_el, ev) => {
      ev.preventDefault()
      const input = qs<HTMLInputElement>('#top-search-input', root)
      const q = (input?.value ?? '').trim()
      if (q) sharedRouter.navigate(`/search?q=${encodeURIComponent(q)}`)
    }),
  )

  /* ---------- player <-> library + prefs ---------- */
  let lastRecordedSong: string | null = null
  unsubs.push(
    player.subscribe((snap) => {
      playerBar.update(snap)
      playerBar.el.hidden = !snap.currentSongId
      rail.update(snap)
    }),
    player.subscribeTick((snap) => rail.update(snap)),
    player.subscribe((snap) => {
      if (!snap.currentSongId) return
      const song = snap.currentSongId
      if (song !== lastRecordedSong) {
        lastRecordedSong = song
        const s = songById(song)
        recordPlayed(song, s?.albumId)
      }
    }),
  )

  /* ---------- global actions ---------- */
  unsubs.push(bindGlobalActions(root))

  /* ---------- router ---------- */
  let renderToken = 0
  let routeAbort: AbortController | null = null
  const renderRoute = (route: Route): void => {
    markActiveNav()
    if (route.name === 'now-playing') {
      nowPlaying.open(route.panel)
      sharedRouter.setRouteTitle('Now Playing')
      return
    }
    // Supersede any in-flight view render: aborts its YouTube mount (so a
    // stale /watch can never replace the committed route's player).
    routeAbort?.abort()
    routeAbort = new AbortController()
    const signal = routeAbort.signal
    nowPlaying.close()
    destroyYouTubeEmbed()
    const token = ++renderToken
    void (async () => {
      // Outgoing wipe (reference): clip the current view toward the left edge.
      // Runs in parallel with the incoming render; skipped under reduced motion.
      // Only home wraps its content in `.view`; every other view renders
      // directly into its slot, so the committed slot itself is the reliable
      // outgoing element for all routes.
      const prevSlot = host.querySelector<HTMLElement>(
        ':scope > .view-slot:not(.is-staging), :scope > .view',
      )
      // Block focus/interaction on the dying view, and drop its element IDs so
      // the staged view can mount the same IDs (#search-input, …) without a
      // duplicate-ID window while both slots are briefly in the document.
      if (prevSlot) {
        prevSlot.setAttribute('inert', '')
        prevSlot.querySelectorAll('[id]').forEach((n) => n.removeAttribute('id'))
      }
      const wipeTarget = prevSlot?.querySelector<HTMLElement>('.view') ?? prevSlot
      const wipeDone =
        wipeTarget && !prefersReducedMotion()
          ? (wipeTarget.classList.add('view-leaving'),
            new Promise<void>((r) => window.setTimeout(r, 200)))
          : Promise.resolve()
      // Stage the incoming view in-DOM (invisible overlay) so async work that
      // needs a live document — YouTube iframes, input focus — behaves
      // normally. `inert` keeps the invisible staging slot out of the tab
      // order and the accessibility tree until commit. Each route owns its
      // slot: a slow, stale render can only write into its own (discarded)
      // slot, never clobber a newer route.
      const next = document.createElement('div')
      next.className = 'view-slot is-staging'
      next.setAttribute('inert', '')
      host.appendChild(next)
      switch (route.name) {
        case 'home':
          sharedRouter.setRouteTitle('Home')
          await renderHome(next)
          break
        case 'browse':
          sharedRouter.setRouteTitle('Browse')
          await renderBrowse(next)
          break
        case 'radio':
          sharedRouter.setRouteTitle('Radio')
          await renderRadio(next)
          break
        case 'search':
          sharedRouter.setRouteTitle(route.q ? `Search “${route.q}”` : 'Search')
          await renderSearch(next, route.q, { lang: route.lang, src: route.src })
          break
        case 'library':
          sharedRouter.setRouteTitle('Library')
          await renderLibrary(next, route.tab)
          break
        case 'album':
          await renderAlbum(next, route.id)
          break
        case 'artist':
          await renderArtist(next, route.id)
          break
        case 'playlist':
          await renderPlaylist(next, route.id)
          break
        case 'song':
          await renderSong(next, route.id)
          break
        case 'genre':
          await renderGenre(next, route.id)
          break
        case 'watch':
          sharedRouter.setRouteTitle('YouTube')
          await renderWatch(next, route.id, { signal })
          break
        case 'not-found':
          sharedRouter.setRouteTitle('Not Found')
          renderNotFound(next, route.path)
          break
      }
      await wipeDone
      if (token !== renderToken) {
        next.remove()
        return
      }
      // Commit: drop every earlier slot, then reveal the staged view.
      host.querySelectorAll<HTMLElement>(':scope > *').forEach((el) => {
        if (el !== next) el.remove()
      })
      next.removeAttribute('inert')
      next.classList.remove('is-staging')
      host.scrollTop = 0
      // Autofocus after commit (inert blocks focus() during staging). Never
      // yank focus out of a text field the user is still typing in (e.g. the
      // top-bar search submit); otherwise move focus into the new view.
      const active = document.activeElement as HTMLElement | null
      const typing =
        active !== null &&
        !next.contains(active) &&
        active.matches('input:not([type="button"], [type="submit"]), textarea, [contenteditable="true"]')
      if (!typing) {
        const auto = next.querySelector<HTMLElement>('[data-autofocus]')
        auto?.focus()
      }
      const h1 = next.querySelector('h1')
      if (h1) revealHeading(h1)
      if (!prefersReducedMotion()) staggerView(next.querySelector<HTMLElement>('.view') ?? next)
      if (h1) sharedRouter.setRouteTitle(h1.textContent?.trim() ?? '')
    })()
  }

  unsubs.push(bindLinkInterception(root, sharedRouter))
  sharedRouter.start(renderRoute)

  function markActiveNav(): void {
    const loc = window.location
    const path = stripBase(loc.pathname).replace(/\/+$/, '') || '/'
    root.querySelectorAll<HTMLElement>('[data-nav-href]').forEach((el) => {
      const href = el.getAttribute('data-nav-href') ?? ''
      const active = href === '/' ? path === '/' : path === href || path.startsWith(href + '/')
      if (active) el.setAttribute('aria-current', 'page')
      else el.removeAttribute('aria-current')
    })
  }

  /* ---------- keyboard ---------- */
  const onKey = (ev: KeyboardEvent): void => {
    const target = ev.target as HTMLElement | null
    if (target && (target.matches('input, textarea, select') || target.isContentEditable)) return
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return
    const snap = player.getSnapshot()
    switch (ev.key) {
      case ' ':
        ev.preventDefault()
        player.togglePlay()
        break
      case 'ArrowRight':
        if (snap.currentSongId) player.seekTo(Math.min(snap.durationMs, snap.positionMs + 5000))
        break
      case 'ArrowLeft':
        if (snap.currentSongId) player.seekTo(Math.max(0, snap.positionMs - 5000))
        break
      case 'ArrowUp':
        ev.preventDefault()
        player.setVolume(Math.min(1, snap.volume + 0.05))
        break
      case 'ArrowDown':
        ev.preventDefault()
        player.setVolume(Math.max(0, snap.volume - 0.05))
        break
      case 'm':
      case 'M':
        player.toggleMute()
        break
      case 'n':
      case 'N':
        player.next()
        break
      case 'p':
      case 'P':
        player.previous()
        break
      case 's':
      case 'S':
        player.setShuffle(!snap.shuffle)
        showToast({ message: snap.shuffle ? 'Shuffle off' : 'Shuffle on', durationMs: 1200 })
        break
      case 'r':
      case 'R':
        player.cycleRepeat()
        break
      case 'q':
      case 'Q':
        sharedRouter.navigate('/now-playing?panel=queue')
        break
      case '/':
        ev.preventDefault()
        // Search autofocuses on commit via [data-autofocus] (inert blocks
        // focus() during the staged render).
        sharedRouter.navigate('/search')
        break
      case 'Escape':
        if (!nowPlaying.el.hidden) sharedRouter.back()
        setDrawer(false)
        break
    }
  }
  window.addEventListener('keydown', onKey)
  unsubs.push(() => window.removeEventListener('keydown', onKey))

  /* ---------- session restore ---------- */
  void (async () => {
    registerDemoIndexIntoEngine()
    const session = prefsStore.get().session
    if (session && session.songIds.length > 0) {
      const songs = (await Promise.all(session.songIds.map((id) => getCatalog().getSong(id)))).filter(
        (s): s is NonNullable<typeof s> => Boolean(s),
      )
      if (songs.length > 0) {
        player.restore(songs, Math.min(session.index, songs.length - 1), session.positionMs, session.contextLabel)
      }
    }
  })()

  /* ---------- persist session on change ---------- */
  unsubs.push(
    player.subscribe((snap) => {
      if (!snap.currentSongId) return
      saveSession({
        songIds: snap.queue.map((q) => q.songId),
        index: snap.index,
        positionMs: snap.positionMs,
        contextLabel: snap.contextLabel,
      })
    }),
  )

  /* ---------- volume / shuffle / repeat prefs ---------- */
  unsubs.push(
    prefsStore.subscribe((p) => {
      if (player.getSnapshot().volume !== p.volume) player.setVolume(p.volume)
      if (player.getSnapshot().muted !== p.muted) player.setMuted(p.muted)
    }),
  )
  player.subscribe((snap) => {
    const p = prefsStore.get()
    if (p.volume !== snap.volume || p.muted !== snap.muted || p.shuffle !== snap.shuffle || p.repeat !== snap.repeat) {
      prefsStore.set((cur) => ({ ...cur, volume: snap.volume, muted: snap.muted, shuffle: snap.shuffle, repeat: snap.repeat }))
    }
  })

  // seed player volume from prefs
  player.setVolume(prefsStore.get().volume)
  if (prefsStore.get().muted) player.toggleMute()
  if (prefsStore.get().shuffle) player.setShuffle(true)
  if (prefsStore.get().repeat !== 'off') {
    // cycle until match (at most 2 steps)
    if (player.getSnapshot().repeat !== prefsStore.get().repeat) player.cycleRepeat()
    if (player.getSnapshot().repeat !== prefsStore.get().repeat) player.cycleRepeat()
  }

  return {
    router: sharedRouter,
    destroy() {
      unsubs.forEach((u) => u())
      nowPlaying.destroy()
    },
  }
}
