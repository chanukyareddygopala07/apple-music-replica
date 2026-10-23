# Build log — Sonora (Apple Music web player recreation)

Clean-room rebuild in vanilla TypeScript. No Apple HTML/CSS/JS/assets/copy was
read or reused; the public site was only screenshotted for layout reference
(`replica/screens/`).

## Milestones

### M0 — Reset to the required stack
- Removed the Next.js scaffold entirely (deps, configs, app dir, its `.git`).
- Vite 7 + TypeScript 5.9 strict (`noUncheckedIndexedAccess`, `verbatimModuleSyntax`),
  Vitest (jsdom), Playwright (chromium), ESLint flat config. Zero runtime deps.
- esbuild postinstall was blocked by npm policy; approved via
  `npm install-scripts approve esbuild`.

### M1 — Recon of the reference
- Captured desktop + mobile screenshots of music.apple.com/in and measured
  layout metrics (`replica/screens/`, `metrics.json`): sidebar 260px, h1 34/700,
  section headers 20/700, song-row art 40px, player bar layout.
- Wrote `replica/recon.md` (14 screens, 5 flows, data model, out-of-scope list)
  and `replica/features.csv` (must/should/could/skip matrix).

### M2 — Design system
- `replica/design/tokens.json` + `src/styles/tokens.css`: light/dark themes,
  type scale, spacing, radii, shadows. Contrast checked with
  `replica-design/contrast.py` → 0 AA failures.
- Brand: "Sonora", violet accent `#6a45f2` (light) / `#9d86ff` (dark) —
  deliberately not Apple red. All icons hand-authored stroke SVGs.

### M3 — Domain + data
- `CatalogProvider` interface; demo provider with 10 artists / 10 albums /
  32 songs / 6 playlists / 5 stations / 8 genres — all fictional.
- Audio: SoundHelix demo MP3s. Artwork: deterministic generated SVG data URIs
  (`artworkDataUrl(seed)`). Optional MusicKit provider implemented defensively
  (search-only, token-gated, no streaming claim).
- Verified: iTunes Search API and lrclib.net both send
  `access-control-allow-origin: *`, but the demo catalogue is original fiction,
  so neither is required at runtime.

### M4 — Engine + state
- `PlayerEngine`: one `HTMLAudioElement` for the app's lifetime; queue ops,
  shuffle with base-order restore, repeat modes, session restore.
  Fixed a shuffle-ordering bug (start item must stay first).
- Tiny observable stores (`createStore`) + localStorage persistence with a
  `pagehide` flush (added late — e2e caught data loss on the 250ms debounce).

### M5 — Shell + views
- Shell: sidebar (nav, playlists, appearance, about), mobile drawer + tabs,
  player bar, Now Playing overlay, theme controller, keyboard shortcuts,
  session restore, route rendering with title updates.
- Views: home (editorial, recently played, grids, carousels), browse, radio,
  search (debounced, tabs, top result), library (5 tabs), album/artist/playlist/
  song/genre detail with art-derived heroes, now-playing (lyrics + queue),
  not-found.
- Global `data-action` delegation: play contexts, transport, favorites,
  song menus (Play Next / Add to Queue / Favorite / Add to Playlist / Go to
  Album|Artist / Remove), settings dialog with provider info + shortcuts.

### M6 — Fixes found by the visual loop
- Grid song rows were showing index numbers instead of artwork → rows now show
  art in grids, numbers only in album/playlist track lists.
- Hero `<img src="">` never loaded generated artwork → `attachArtworkFallback`
  now fills empty src from `data-seed` and retries generated art before the
  letter fallback.
- `heroColors` used a different palette offset than `artworkDataUrl`, so heroes
  didn't match their album art → same palette index now; hero text colour is
  computed from gradient luminance (dark text on light palettes).
- Hero gradients fade to the page background within the first viewport
  (fixed px stops) instead of the full page height.
- `PlayerEngine.restore()` now sets `currentSongId` synchronously so the player
  bar shows the restored track before metadata loads.

### M7 — Quality gates
- 43 Vitest unit tests: format helpers, router parsing, library store
  (favorites/playlists/history), player engine (queue/shuffle/repeat/restore),
  demo-catalogue integrity (unique ids, referential integrity), artwork
  determinism.
- 10 Playwright e2e tests: shell render, navigation, search, playback + player
  bar, playback surviving navigation, queue panel, favorite→library,
  playlist create + add song, genre from search categories, `/` shortcut,
  not-found.
- Final gate: `npm run lint` ✓ · `npm run typecheck` ✓ · `npm test` 43/43 ✓ ·
  `npm run build` ✓ (103 kB JS / 38 kB CSS gzipped ~30.5 / 7.3) ·
  `npm run test:e2e` 10/10 ✓ · `npm run capture:clone` 0 console errors,
  player bar verified ("Harbor Lights" playing).

## Reference vs clone screenshots

- Reference (original site): `replica/screens/`
- Clone: `replica/clone-screens/` (+ `smoke-report.json`)

## Honest limitations

- Fictional catalogue + demo audio; no Apple content.
- MusicKit search-only, untested with credentials; no streaming claim.
- Local library only (no accounts/sync) — the original's sign-in wall is
  replaced with a fully working local library.
- Lyrics for 5 demo tracks with approximate timings.
