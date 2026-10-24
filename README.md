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
| `npm run smoke:audius` | Live browser check: Audius search + real playback (needs network) |
| `npm run smoke:musickit` | Live MusicKit search harness (exit 2 until configured) |

## What's inside

- **Playback engine** (`src/engine/player.ts`) — one long-lived `HTMLAudioElement`,
  never recreated. Queue with Play Next / Add to Queue / remove / reorder / clear,
  shuffle (with base-order restore), repeat off/all/one, seek, volume/mute,
  autoplay-block handling, session restore (paused) across reloads.
- **Routing** — History-API SPA router, framework-free; the player survives
  navigation because the audio element lives in the shell, not the views.
- **Catalogue** (`src/data/`) — two layers behind one facade: a **free live
  catalogue from [Audius](https://audius.co)** (search, charts, artists,
  playlists, artist albums, real streamed audio) enabled by default, and a
  fictional demo catalogue (10 artists, 10 albums, 32 songs, playlists,
  stations, genres) with streaming audio from
  [SoundHelix](https://www.soundhelix.com) and deterministic generated SVG
  artwork that always acts as the fallback — an Audius outage can never break
  the app (see below).
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

## Audius (free external music provider)

Audius is the app's **primary external catalogue and streaming source** —
a free, public API with no paid dependency:

- **On by default.** Anonymous access needs no credentials
  (`VITE_AUDIUS_ENABLED=0` switches to demo-only). An optional free-plan key
  (`VITE_AUDIUS_API_KEY`) is sent the way the official Audius SDK sends it —
  as an `api_key` query parameter; Vite embeds `VITE_*` values in the public
  bundle, so never put anything secret there (the Bearer/user-token flow is
  backend-only and is not used by this app at all).
- **What it provides:** search (tracks, artists, playlists), trending +
  underground charts, track/artist/playlist pages, an artist's top songs and
  albums, and real streaming URLs — playback uses the existing player engine
  unchanged (`<audio>` follows Audius's 302 redirect and honours Range
  requests, so seeking works).
- **Rate limits:** the free plan allows 10 requests/second and 500k/month;
  the client enforces a ~130 ms gap between requests, caches responses
  (search 60 s, entities 5 min), retries a `429` once and then fails typed —
  the facade always falls back to the demo catalogue.
- **Unsupported by the Audius API** (documented, never faked): editorial
  home/browse feature cards, stations, genre pages, time-synced lyrics,
  ratings, and dedicated album search (an artist's albums are surfaced on
  their page instead). Home/Browse therefore mix Audius song charts and
  playlists over the demo editorial base.
- **Deterministic tests:** unit tests cover normalisation, the client's
  error/rate-limit/cache behaviour and the facade fallback with injected
  fetches; the e2e suite builds with `VITE_AUDIUS_ENABLED=0` so it never
  depends on the live API. Live behaviour is verified separately with
  `npm run smoke:audius`.

## Optional Apple Music (MusicKit) provider

Audius (above) is the primary external provider; Apple Music remains an
**optional, separate future integration** with its own secure plumbing
(`replica/musickit-milestone.md` tracks that plan).

Sonora ships an optional, defensive MusicKit provider (`src/data/musickit-provider.ts`)
with M1 secure token plumbing (`src/data/musickit-token.ts`).

- **The `.p8` private key never enters this repository or the browser.** It
  lives only on a separate private token-signing service that returns
  `{"token":"<ES256 JWT>"}`; that service also asserts Apple's recommended
  `origin` claim.
- **Two-key activation gate:** MusicKit activates only when both are set:
  `VITE_MUSICKIT_ENABLED=1` **and** a token source — either
  `VITE_MUSICKIT_TOKEN_URL` (runtime fetch with caching, 60s-before-expiry
  refresh, single-flight requests, typed error handling) or, for local
  development only, a pre-signed `VITE_MUSICKIT_DEVELOPER_TOKEN`. With no
  env vars the app is pure demo mode: **no token fetch, no MusicKit CDN
  script, no MusicKit request** (asserted by unit and e2e tests).
- A failing token service or MusicKit initialization **never breaks demo
  playback** — the provider resolves to null and the catalogue facade falls
  back to the demo provider.
- Even with a token, catalogue **streaming** requires user authorization and an
  active Apple Music subscription, and is routed through MusicKit's own engine.
- This project implements catalogue **search + entity mapping only** and makes
  **no claim that MusicKit initialization or streaming works here** — the
  plumbing is tested with mocks, but live `MusicKit.configure()` has **not**
  been verified because no signing service or Apple credentials are available
  (external prerequisites: Apple Developer Program, media identifier, `.p8`,
  and the token-signing service). Demo mode is fully functional without any
  of this.

## Search filters (language + source)

The search page carries two selectors under the query field — **Language** and
**Source** — both defaulting to `All languages` / `All sources`. They are real
state: saved in `localStorage`, written to the URL
(`/search?q=…&lang=…&src=…`, so a filtered search is shareable), and passed to
the catalogue facade (`searchGrouped()`), which queries each source
independently.

How filtering stays honest:

- **Sources are capability-gated, not guessed.** A source is queried only when
  it can apply the selected language:
  - **Demo catalogue** — English only (`en`), because all of its fictional
    content is English.
  - **Audius** — the Audius API has **no language parameter**, so Audius is
    searched only under `All languages`; it never pretends to have filtered.
  - **Apple Music (MusicKit)** — no language filter is implemented here, so it
    behaves the same way: `All languages` only.
  - **Jamendo / YouTube** — not offered. Their providers exist in the tree but
    are not wired into this build's catalogue facade, so they never appear as
    working sources and never receive a query.
- **Hidden sources are named.** When a language hides a source you could
  otherwise search, the results page says which ones ("Hidden for French: Sonora
  Demo."); if nothing can answer the query, the empty state explains why instead
  of showing a silent blank.
- **`Other languages` is a UI-only bucket.** No source can filter by it yet
  (it carries no ISO 639-1 code), so selecting it hides every source and says so
  — no fake matches.
- **Tracks without language metadata are never excluded.** No demo/Audius track
  carries a language claim today, so per-track filtering is a safety net
  (`Song.language` + `songMatchesLanguage()`) that stays inert until a provider
  reports a language; unknown-language tracks stay visible rather than being
  dropped on a guess.
- **Failures are per source.** Each source is queried in isolation: an Audius
  outage marks that group as an error with a notice above the results while the
  demo results keep working (the same fallback the flat search always had), and
  picking one specific source never silently falls back to another.
- **The source selector lists only what this build can search** — `All
  sources`, Audius (when enabled), Apple Music (when configured), Sonora Demo.
  A stale URL pointing at an unavailable source clamps back to `All sources`.

## Layout

```
src/
  app/        shell (sidebar, mobile chrome, keyboard), router, global actions
  data/       demo catalogue, provider facade, Audius provider (free, default-on),
              optional MusicKit provider, remote entity registry
  domain/     shared types + CatalogProvider interface
  engine/     PlayerEngine (singleton `player`)
  state/      tiny observable stores + localStorage persistence
  styles/     design tokens + component CSS
  ui/         icons, dialogs, menus, sliders, toasts, player bar, queue, lyrics
  views/      home, browse, radio, search, library, album, artist, playlist,
              song, genre, now-playing, not-found
scripts/      capture-reference.mjs, capture-clone.mjs, musickit-smoke.mjs,
              audius-smoke.mjs
tests/unit    Vitest suites
tests/e2e     Playwright suites
replica/      recon notes, feature matrix, screenshots, milestone plan
```

## Limitations

- The demo fallback catalogue is fictional; its audio is SoundHelix demo
  MP3s (not the Apple catalogue, not licensed music). Audius content is
  real, user-uploaded music streamed from Audius's CDN; availability and
  catalogue depend on the live public API.
- With Audius enabled the app needs network for remote results; offline or
  during an Audius outage everything falls back to the demo catalogue.
- No accounts or cross-device sync — the library is local to your browser.
- Lyrics exist for five demo tracks; timings are approximations. Audius
  tracks have no lyrics in this app.
- MusicKit streaming is out of scope (see above).
- Search language filtering is capability-based: Audius and MusicKit accept no
  language parameter, so selecting a language narrows the search to sources that
  can honour it (today: the English-only demo catalogue, under `en`).
