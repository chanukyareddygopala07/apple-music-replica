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
| `npm run smoke:jamendo` | Live browser check: Jamendo search + real playback (needs `VITE_JAMENDO_CLIENT_ID`, network) |
| `npm run smoke:musickit` | Live MusicKit search harness (exit 2 until configured) |

## What's inside

- **Playback engine** (`src/engine/player.ts`) — one long-lived `HTMLAudioElement`,
  never recreated. Queue with Play Next / Add to Queue / remove / reorder / clear,
  shuffle (with base-order restore), repeat off/all/one, seek, volume/mute,
  autoplay-block handling, session restore (paused) across reloads.
- **Routing** — History-API SPA router, framework-free; the player survives
  navigation because the audio element lives in the shell, not the views.
- **Catalogue** (`src/data/`) — several layers behind one facade: a **free live
  catalogue from [Audius](https://audius.co)** (search, charts, artists,
  playlists, artist albums, real streamed audio) enabled by default, an
  optional **[Jamendo](https://www.jamendo.com)** Creative-Commons catalogue
  (search + streaming once a client id is set), and a fictional demo
  catalogue (10 artists, 10 albums, 32 songs, playlists,
  stations, genres) with streaming audio from
  [SoundHelix](https://www.soundhelix.com) and deterministic generated SVG
  artwork that always acts as the fallback — a provider outage can never break
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

## Jamendo (free Creative Commons catalogue)

Sonora can also search and stream **[Jamendo](https://www.jamendo.com)** — a free
catalogue of artist-uploaded Creative Commons music — alongside Audius and the
demo catalogue.

- **Getting a client id (free):** sign up at
  [devportal.jamendo.com](https://devportal.jamendo.com) → create an
  *application* (the default read-only plan fits this app) → copy its
  **client id**. Every read call sends it as Jamendo's documented `client_id`
  GET parameter. It is a **public build-time value** (Vite embeds every
  `VITE_*` variable in the bundle, and Jamendo's own docs publish a test id
  for read calls) — not a secret. Never put OAuth access tokens or a
  `client_secret` in client config: this app uses only the unauthenticated
  read API and has no OAuth flow.
- **Local setup:** create a `.env` (gitignored) with
  `VITE_JAMENDO_CLIENT_ID=<your id>` — or `VITE_JAMENDO_ENABLED=0` to keep
  Jamendo off entirely. `.env.example` documents both.
- **Production setup:** repo Actions *variables* (not secrets):
  `gh variable set VITE_JAMENDO_CLIENT_ID --body "<your id>"` (optional
  `VITE_JAMENDO_ENABLED`); the Pages workflow passes them into the build.
- **Language filter:** with a specific language selected, Jamendo queries
  carry Jamendo's documented 2-letter `lang` parameter (server-side
  filtering, e.g. `zh-Hans`/`zh-Hant` → `zh`); under `All languages` no
  `lang` parameter is sent at all. Each track's stated lyrics language
  (`musicinfo.lang`) is kept as `Song.language` when present — but tracks
  without one stay eligible rather than being dropped on a guess, because
  Jamendo's own server-side filter, not our metadata, decides. A language
  Jamendo cannot represent (`Other languages`) hides the source with a named
  notice.
- **Playback & licensing:** results stream Jamendo's documented `audio` URL
  through the app's existing `<audio>` engine (seek, queue, pause, shuffle
  unchanged). Downloads are never offered. Every Jamendo song keeps its
  Creative Commons licence (`license_ccurl` → a "CC …" link on the song
  page) plus the source attribution — the artist byline is the required
  credit. Licences vary per track (BY / BY-NC / BY-NC-ND / BY-SA …); this
  app only plays the stream and links to the licence page, it never
  redistributes files.
- **Unsupported (documented, never faked):** editorial home/browse cards,
  stations, genre pages, playlists, lyrics, ratings.
- **Without a client id:** Jamendo simply is not offered — the source
  selector omits it, a shared URL with `src=jamendo` shows an honest
  "unconfigured" notice naming `VITE_JAMENDO_CLIENT_ID`, and **zero
  requests** are made. Audius and the demo catalogue behave exactly as
  before.
- **Verification:** unit tests cover config, client, normalisation,
  provider routing and the facade grouping with injected fetches;
  `npm run smoke:jamendo` is the live browser check (search → row → real
  playback → elapsed time advancing).

## YouTube (official watch embed)

Sonora can search **YouTube** for embeddable videos and play them in the
**official YouTube player** on a dedicated `/watch/:id` page — a separate
playback path that never touches the `<audio>` engine.

- **Discovery needs a key; playback never does.** Search uses the
  [YouTube Data API v3](https://developers.google.com/youtube/v3/docs/search/list)
  (`search.list` with `type=video` + `videoEmbeddable=true`, `maxResults=10`,
  plus one cheap `videos.list` for durations). Playback uses the official
  [IFrame Player API](https://developers.google.com/youtube/iframe_api_reference)
  embed, which requires no key — a keyless build still opens `/watch` and
  plays (privacy-enhanced embed), falling back to an external "Watch on
  YouTube" link if the player cannot start.
- **Getting a key (free):** [console.cloud.google.com](https://console.cloud.google.com)
  → create a project → enable **YouTube Data API v3** → *Credentials* →
  *Create API key* → **restrict it by HTTP referrer** (API restrictions).
  It is a **public build-time value** (Vite embeds every `VITE_*` variable in
  the bundle) — the referrer restriction is the protection, never treat the
  key as a secret in client config. Quota: the free tier allows **100
  `search.list` calls/day**; this app spends 1 search + 1 `videos.list` per
  query (quota errors surface as an honest per-source error notice).
- **Local setup:** `VITE_YOUTUBE_API_KEY=<your key>` in `.env` (or
  `VITE_YOUTUBE_ENABLED=0` to force it off). **Production setup:** repo
  Actions *variables* (not secrets): `gh variable set VITE_YOUTUBE_API_KEY
  --body "<your key>"` — the Pages workflow passes them into the build.
- **Without a key:** the source selector omits YouTube, a shared URL with
  `src=youtube` shows an honest "unconfigured" notice naming
  `VITE_YOUTUBE_API_KEY`, and **zero requests** are made — the same contract
  as Jamendo. Audius/Jamendo/demo behave exactly as before.
- **Dedicated view, never blended (policy decision).** YouTube results only
  appear under the explicit `YouTube` source filter and on `/watch` — they are
  **excluded from `All sources` aggregation**. YouTube's current policy
  guidance is ambiguous about combining API data with other sources
  ([Developer Policies III.E.2](https://developers.google.com/youtube/terms/developer-policies)
  / III.C.5 vs. the compliance guide's side-by-side example), so this app
  takes the conservative reading: YouTube rows always carry their own
  attribution and are never intermixed into another provider's result list.
- **Language filter:** a selected language is sent as YouTube's
  `relevanceLanguage` (e.g. `zh-Hans`/`zh-Hant` pass through as documented;
  `Other languages` hides the source). It is a relevance **hint**, never a
  language verification — results are shown as YouTube's, not relabelled.
- **Playback rules honoured:** the player is visible and clearly YouTube's
  (never backgrounded, never audio-only, default YouTube controls — no
  `playerVars` overrides), **never autoplays** (press play), and opening
  `/watch` pauses the Sonora audio engine so two sources can never overlap.
  Navigating away destroys the embed. Error codes and embed restrictions fall
  back to the official watch link.
- **Made-for-kids (Developer Policies III.E.4.j):** each video's
  `status.madeForKids` is looked up via `videos.list`; made-for-kids (or
  unknown) videos embed through **privacy-enhanced mode**
  (`youtube-nocookie.com`), confirmed non-MFK videos use the standard embed.
  The lookup result lives in session memory only; search/detail caches are
  in-memory TTLs (60s/5min) and nothing about viewing is persisted.
- **Unsupported (documented, never faked):** channel/album search lists,
  editorial feeds, playlists, stations, genre pages. A channel's songs come
  only from what this session has already seen (a channel search would spend
  a full quota call).
- **Before you launch publicly:** YouTube's policies require your app to have
  its own Terms of Service and Privacy Policy and to link YouTube's Terms of
  Service (III.A.1/A.2) — the watch page already links YouTube's Terms;
  shipping the full legal pages is a pre-launch task (see
  `replica/mvp-reference-plan.md` §8).
- **Verification:** unit tests cover config, client (params/error
  mapping/TTL cache), normalisation, provider routing/MFK, the embed wrapper
  (ready-gating, privacy-enhanced mode, state/error events) and the facade's
  dedicated-view policy; five e2e tests cover the keyless contracts (source
  absent, `?src=youtube` notice, watch fallback + engine pause, zero
  googleapis requests). **Live search with a real key has not been verified**
  (no key available for this environment — honesty over claims).

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
  - **Jamendo** (offered when a client id is configured) — can filter: its
    queries carry Jamendo's documented 2-letter `lang` parameter
    (`zh-Hans`/`zh-Hant` → `zh`), applied by Jamendo's servers.
  - **YouTube** (offered when an API key is configured) — sends YouTube's
    `relevanceLanguage` for the selected language (`zh-Hans`/`zh-Hant` pass
    through as YouTube documents), a relevance **hint** applied by YouTube's
    servers; `Other languages` hides it like every unrepresentable language.
    YouTube is additionally never part of `All sources` — it only answers
    under its own explicit source filter (policy decision, see the YouTube
    section above).
  - **Apple Music (MusicKit)** — no language filter is implemented here, so it
    behaves the same way: `All languages` only.
- **Hidden sources are named.** When a language hides a source you could
  otherwise search, the results page says which ones ("Hidden for French: Sonora
  Demo."); if nothing can answer the query, the empty state explains why instead
  of showing a silent blank.
- **`Other languages` is a UI-only bucket.** No source can filter by it yet
  (it carries no ISO 639-1 code), so selecting it hides every source —
  Jamendo included — and says so — no fake matches.
- **Tracks without language metadata are never excluded.** Demo/Audius tracks
  carry no language claim, so per-track filtering is a safety net
  (`Song.language` + `songMatchesLanguage()`) that stays inert for them;
  unknown-language tracks stay visible rather than being dropped on a guess.
  Jamendo tracks state their lyrics language when the API's `musicinfo`
  provides it, but Jamendo results are narrowed by the server-side `lang`
  filter — the client never second-guesses that with its own exclusions.
- **Failures are per source.** Each source is queried in isolation: an Audius
  or Jamendo outage marks that group as an error with a notice above the
  results while the other sources' results keep working (the same fallback
  the flat search always had), and picking one specific source never
  silently falls back to another.
- **The source selector lists only what this build can search** — `All
  sources`, Audius (when enabled), Jamendo (when a client id is configured),
  YouTube (when an API key is configured), Apple Music (when configured),
  Sonora Demo. A stale URL pointing at an unavailable source clamps back to
  `All sources` — except `src=youtube`, which shows its honest setup notice
  instead of silently pretending nothing was asked.

## Layout

```
src/
  app/        shell (sidebar, mobile chrome, keyboard), router, global actions
  data/       demo catalogue, provider facade, Audius provider (free, default-on),
              Jamendo provider (free CC catalogue, needs a client id),
              optional MusicKit provider, remote entity registry
  domain/     shared types + CatalogProvider interface
  engine/     PlayerEngine (singleton `player`)
  state/      tiny observable stores + localStorage persistence
  styles/     design tokens + component CSS
  ui/         icons, dialogs, menus, sliders, toasts, player bar, queue, lyrics
  views/      home, browse, radio, search, library, album, artist, playlist,
              song, genre, now-playing, not-found
scripts/      capture-reference.mjs, capture-clone.mjs, musickit-smoke.mjs,
              audius-smoke.mjs, jamendo-smoke.mjs
tests/unit    Vitest suites
tests/e2e     Playwright suites
replica/      recon notes, feature matrix, screenshots, milestone plan
```

## Limitations

- The demo fallback catalogue is fictional; its audio is SoundHelix demo
  MP3s (not the Apple catalogue, not licensed music). Audius content is
  real, user-uploaded music streamed from Audius's CDN; availability and
  catalogue depend on the live public API. Jamendo content is real
  Creative-Commons music streamed from Jamendo's storage CDN; it appears
  only when a client id is configured, and licences vary per track (shown
  on each song page — downloads are never offered by this app).
- With Audius or Jamendo enabled the app needs network for remote results;
  offline or during a provider outage everything falls back to the demo
  catalogue.
- No accounts or cross-device sync — the library is local to your browser.
- Lyrics exist for five demo tracks; timings are approximations. Audius
  tracks have no lyrics in this app (and Jamendo lyrics are out of scope:
  only the stated language metadata is read).
- MusicKit streaming is out of scope (see above).
- YouTube discovery spends from a free quota of **100 searches/day** and has
  **not been verified live with a real key** (keyless contracts are tested).
  YouTube playback is always YouTube's official embedded player on `/watch`
  (visible, never autoplayed, never merged into the audio queue), and a
  public launch still needs this app's own Terms of Service + Privacy Policy
  (YouTube Developer Policies III.A.1/A.2 — the watch page already links
  YouTube's Terms).
- Search language filtering is capability-based: Audius and MusicKit accept
  no language parameter, so selecting a language narrows the search to
  sources that can honour it (today: the English-only demo catalogue under
  `en`, and Jamendo — when configured — under any language Jamendo's `lang`
  parameter supports, with `Other languages` supported by none).
