# Sonora

A framework-free recreation of the Apple Music web player experience, built as an
independent demo. Vanilla TypeScript + modern CSS + native browser APIs, bundled
with Vite only because browsers cannot run `.ts` directly.

**Not affiliated with Apple.** Original brand, palette, copy, icons and a fictional
demo catalogue — no Apple assets, trade dress, or catalogue data.

**Live demo:** https://chanukyareddygopala07.github.io/apple-music-replica/

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
```

Other scripts:

| Script | What it does |
| --- | --- |
| `npm run build` | Typecheck + production build to `dist/` |
| `npm run preview` | Serve the production build |
| `npm run typecheck` | `tsc --noEmit` (strict, `noUncheckedIndexedAccess`) |
| `npm run lint` | ESLint (flat config + typescript-eslint) |
| `npm test` | Vitest unit tests (jsdom) |
| `npm run test:e2e` | Playwright end-to-end tests (builds + preview on :4173) |
| `npm run capture:reference` | Screenshot the public Apple Music site for reference |
| `npm run capture:clone` | Screenshot this app + smoke-test playback |

## What's inside

- **Playback engine** (`src/engine/player.ts`) — one long-lived `HTMLAudioElement`,
  never recreated. Queue with Play Next / Add to Queue / remove / reorder / clear,
  shuffle (with base-order restore), repeat off/all/one, seek, volume/mute,
  autoplay-block handling, session restore (paused) across reloads.
- **Routing** — History-API SPA router, framework-free; the player survives
  navigation because the audio element lives in the shell, not the views.
- **Catalogue** (`src/data/`) — a fictional demo catalogue (10 artists, 10 albums,
  32 songs, playlists, stations, genres) with real streaming audio from
  [SoundHelix](https://www.soundhelix.com) and deterministic generated SVG artwork
  (no external images).
- **Library** — favorites (songs + albums), user playlists (create/rename/delete,
  add/remove/reorder tracks), recently played — all persisted in `localStorage`
  (with a `pagehide` flush so nothing is lost on tab close).
- **Now Playing** — full-screen overlay with large artwork, transport, and
  Lyrics / Queue side panel. Five demo tracks carry embedded time-synced lyrics.
- **Design system** (`src/styles/tokens.css`) — light/dark themes (system-aware),
  AA-verified contrast (checked with the replica-design contrast tool), art-derived
  page themes (hero colours and text colour computed from each album's generated
  artwork).
- **Mobile shell** — drawer + 4-tab bar + compact player under 834px.
- **Keyboard** — Space play/pause, ←/→ seek 5s, ↑/↓ volume, M mute, N/P next/prev,
  S shuffle, R repeat, Q queue, `/` search, Escape closes Now Playing.

## Optional Apple Music (MusicKit) provider

Sonora ships an optional, defensive MusicKit provider (`src/data/musickit-provider.ts`).

- Requires an Apple Developer account; you create a MusicKit key (`.p8`) and
  **sign a developer token on a server** (the private key must never reach the
  browser). Put the signed token in `.env` as `VITE_MUSICKIT_DEVELOPER_TOKEN`.
- Even with a token, catalogue **streaming** requires user authorization and an
  active Apple Music subscription, and is routed through MusicKit's own engine.
- This project implements catalogue **search + entity mapping only**, activates
  only when a token is present, and makes **no claim that MusicKit streaming
  works here** — it has not been tested with credentials. Demo mode is fully
  functional without any of this.

## Layout

```
src/
  app/        shell (sidebar, mobile chrome, keyboard), router, global actions
  data/       demo catalogue, provider facade, optional MusicKit provider
  domain/     shared types + CatalogProvider interface
  engine/     PlayerEngine (singleton `player`)
  state/      tiny observable stores + localStorage persistence
  styles/     design tokens + component CSS
  ui/         icons, dialogs, menus, sliders, toasts, player bar, queue, lyrics
  views/      home, browse, radio, search, library, album, artist, playlist,
              song, genre, now-playing, not-found
scripts/      capture-reference.mjs, capture-clone.mjs
tests/unit    Vitest suites (43 tests)
tests/e2e     Playwright suites (10 tests)
replica/      recon notes, feature matrix, reference + clone screenshots
```

## Limitations

- Fictional demo catalogue; audio is SoundHelix demo MP3s (not the Apple
  catalogue, not licensed music).
- No accounts or cross-device sync — the library is local to your browser.
- Lyrics exist for five demo tracks; timings are approximations.
- MusicKit streaming is out of scope (see above).
