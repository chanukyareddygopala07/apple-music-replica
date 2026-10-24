# Sonora — Open-Source Reference Audit and MVP Improvement Plan

**Date reviewed:** 2026-10-24
**Sonora baseline:** local `main` @ `d95a7f4` (committed: language/source filters + Audius + Jamendo) plus the intentional, uncommitted YouTube/watch work (3 mixed shared files + 6 untracked files).
**Scope of this document:** research and planning only. No application source code, configuration, reports, workflows, or Git state were modified by this audit. No reference code was copied.

---

## 1. Executive recommendation

Sonora's web MVP foundation is already stronger than a quick glance at these six references suggests: it ships a framework-free player with a real queue, session/queue restore, favorites, playlists, recently-played persistence, capability-gated multilingual search across four catalogue providers, per-source failure isolation, time-synced lyrics (demo tracks), and a 240-unit-test + 12-E2E-test gate set. Do not rebuild any of that.

The highest-value work, in order, is therefore small and surgical:

1. **Harden the release gate** — run the existing E2E suite in CI so a broken UI cannot deploy (all six references run tests in CI; Sonora's Pages workflow currently stops at unit tests).
2. **Land the in-flight YouTube/watch slice** — it is already half-built with the correct, legal posture (official YouTube Data API v3 for discovery + official IFrame embed for playback, keyless playback, honest "unconfigured" state). Finishing it completes the multilingual source matrix and protects the uncommitted work, while keeping YouTube playback structurally distinct from the `<audio>` providers.
3. **Extend lyrics to remote tracks via LRCLIB** — a documented, key-less, openly accessible lyrics API; Sonora already has the time-synced renderer and `Song.lyrics` field. Fallback must stay the current honest "no lyrics" state.
4. **Media Session API integration** — native lock-screen/OS media-key control for a web app, framework-free and feature-detected.
5. **Local listening history + stats view** — the one clearly missing "daily driver" feature that every reference in this set ships, built entirely on the persistence Sonora already has.

Licence posture: koel is MIT and lx-music-desktop is Apache-2.0 (permissive — reuse *allowed* with notices, but their stacks are PHP/Vue and Electron/Vue, so **learning design ideas** is the realistic path). sonorahq/sonora (GPL-3.0) and Metrolist (GPL-3.0) are design-inspiration only — **no code reuse without a GPL compliance plan**. Nuclear is AGPL-3.0 — **no code reuse without an explicit approval and AGPL obligations plan**. Nothing recommended below requires copying code from any reference.

Music-source safety: none of the milestones rely on scraping, unofficial streaming endpoints, YouTube audio extraction, DRM circumvention, or downloaded catalogues. The YouTube slice uses Google's documented API with a referrer-restricted key and plays through the official embed; lyrics use LRCLIB's public documented API; audio comes from Audius's public API, Jamendo's documented storage URLs, SoundHelix demo files, or (future, separately planned) Apple Music via MusicKit.

---

## 2. Reference project comparison

| Project | Product / platform | Providers & playback | Standout features | Testing & dev practice | Licence (verified) | Adapt to Sonora | Avoid |
|---|---|---|---|---|---|---|---|
| [sonorahq/sonora](https://github.com/sonorahq/sonora) | Native desktop client, Rust + GPUI (macOS/Windows/Linux/FreeBSD). **Unrelated project — name collision with this repo.** | Apple Music, Spotify (librespot), YouTube Music, Deezer, Tidal, Subsonic/Navidrome, local files | Gapless, normalization, sleep timer, synced/karaoke lyrics + romanization, scrobbling (Last.fm/ListenBrainz/LibreFM/Maloja), 15-language UI, explicit anti-piracy charter | README-level only: contributing guide, `AGENTS.md`/`CLAUDE.md`, published AI-contribution policy; release CI badge; tests not inspected | **GPL-3.0-or-later** (COPYING read) | Anti-piracy/legality framing for Sonora docs; scrobbling concept (deferred); romanized/karaoke lyrics idea (deferred); i18n ambition (deferred) | All GPL code; desktop-native stack; subscription-service integrations |
| [MetrolistGroup/Metrolist](https://github.com/MetrolistGroup/Metrolist) | YouTube Music client for Android (Kotlin, Jetpack Compose, Material 3); currently in maintenance mode | YouTube Music via innertube + NewPipe extractor; YT Music account login/sync; offline downloads | Live synced lyrics + AI lyrics translation, quick picks, equalizer/normalization/crossfade/skip-silence/tempo, sleep timer, "listen together", Last.fm scrobble, Weblate i18n | README-level only: Blacksmith CI badge; test suite not inspected | **GPL-3.0** (LICENSE read) | Concept list: sleep timer and synced-lyrics UX ideas | All GPL code; innertube/NewPipe extraction (unofficial internals); downloads; account login; Android/Kotlin stack |
| [nukeop/nuclear](https://github.com/nukeop/nuclear) | Free desktop music player (Tauri: Rust + React; pnpm monorepo + Turborepo) | Plugin-provided streaming/metadata sources ("stream from any source") | Listening history + listening stats, favorites (songs/albums/artists), playlist import/export, plugin store, themes, synced lyrics with furigana/translations, MCP server for AI control, phone remote (Nuclear Jam), i18n | README-level: `pnpm test`, `pnpm lint`, `pnpm type-check`, Storybook; monorepo tooling | **AGPL-3.0** (LICENSE read) | History + stats UX (M5); playlist import/export (deferred follow-on); per-source stream candidates concept (Sonora already has grouped sources) | **No AGPL code reuse without approval + compliance plan**; unofficial source plugins; MCP (deferred) |
| [koel/koel](https://github.com/koel/koel) | Self-hosted web streaming for a *personal* collection (Laravel + Vue); premium "Koel Plus" for orgs | Server-scanned personal library; Last.fm/Spotify/MusicBrainz integrations | Smart playlists, scrobbling, podcasts, radio, AI assistant (natural-language commands), mobile player | README-level: frontend unit-tests GitHub Actions badge, Scrutinizer quality badge | **MIT** (LICENSE read, © 2015 Phan An) | Permissive licence = reuse permitted with notice, but stack mismatch → learn concepts: smart playlists (after M5 data exists), scrobbling flow (deferred) | Backend/self-hosted model (Sonora is static GitHub Pages); Spotify integration (credentials) |
| [lyswhut/lx-music-desktop](https://github.com/lyswhut/lx-music-desktop) | Electron + Vue 3 desktop player (Chinese UI); successor project "Any Listen" in progress | User-added music sources (custom source model) | Multi-device sync server, open local HTTP API, Scheme URL control, portable mode, hotkeys | README-level: build/beta workflow badges, contribution rules (issue-first for features, PRs to `dev`); test suite not inspected | **Apache-2.0** (LICENSE read) | Concepts only: optional future local open API / data sync ideas | Custom-source model (unofficial endpoints); Electron stack; Apache code reuse unnecessary given stack gap |
| [pear-devs/pear-desktop](https://github.com/pear-devs/pear-desktop) | Electron YouTube Music desktop "extension" (native look & feel); license file credits `th-ch`, indicating lineage from the youtube-music project | YouTube Music (Electron app internals — not inspected) | Themes, in-app plugin system (BrowserWindow/HTML manipulation), Weblate translations | README-level: `pnpm test` using **Playwright**, ESLint, devcontainers | **MIT** (license file read) | Confirms Sonora's Playwright choice; plugin idea (deferred) | YouTube internal APIs for playback/metadata (Sonora uses the official iframe); Electron stack |

*Research depth per project: GitHub repository page + README (raw) + LICENSE file text + GitHub API metadata (default branch, detected licence, topics, activity). **No reference's source code was inspected** beyond licence files. Feature claims are README-level.*

---

## 3. Licence considerations

1. **Design learning vs. code reuse.** Everything in this plan is *design learning* (features, UX patterns, architecture shape). No file, function, or asset from any reference is copied into Sonora.
2. **Permissive:**
   - **koel — MIT**: reuse allowed with the copyright notice preserved. Realistic barrier is stack (Laravel/Vue), not licence. Sonora has no PHP or Vue.
   - **lx-music-desktop — Apache-2.0**: reuse allowed with NOTICE/attribution obligations. Same stack gap applies.
   - **pear-desktop — MIT**: reuse allowed with notice; its licence file credits `th-ch`, so any reuse would need lineage care. Not needed.
3. **Copyleft — no reuse without a plan:**
   - **sonorahq/sonora — GPL-3.0-or-later**: incorporating code into Sonora would impose GPL source obligations on the distributed web app. Prohibited in this plan without explicit approval + compliance plan.
   - **Metrolist — GPL-3.0**: same, plus it is Android/Kotlin.
   - **nuclear — AGPL-3.0**: the strongest obligation (network use triggers source availability). **Explicit approval and an AGPL compliance plan are prerequisites for any reuse — none is proposed.**
4. **Data and media are separate rights.** Licences above cover *code*. Music metadata, lyrics, audio, and artwork come from their own sources:
   - **Audius**: public API, terms apply; streamed from Audius CDN (already integrated; live-verified smoke).
   - **Jamendo**: documented read API; per-track Creative Commons licences are shown on each song page (already integrated; live verification honestly reported as failed pending a working client id).
   - **LRCLIB (proposed lyrics)**: public, key-less, documented API ("openly accessible to all users and applications"; anonymous access allowed; stricter limits for unregistered clients; optional public `Lrclib-App-Id` header). **Exact content-licence/attribution terms were not verified and must be read before shipping (see §8).**
   - **YouTube Data API v3 + IFrame player (proposed, partially built)**: Google's documented products; browser key restricted by HTTP referrer; `videoEmbeddable=true` pins results to embeddable videos; playback via the official embed without a key. Quota reality: 100 `search.list` calls/day on the free allocation (the uncommitted client already accounts for this).
   - **SoundHelix demo MP3s**: existing demo fallback (fictional catalogue, no licensed music).
   - **Apple Music / MusicKit**: separate, already-planned path with its own credential rules (`replica/musickit-milestone.md`).
5. **Prohibited outright** (reaffirmed): scraping or copying catalogues/metadata/signed URLs; unofficial streaming endpoints; DRM bypass; YouTube audio extraction or hidden/background YouTube playback; anything resembling the download features of Metrolist/lx-music. Sonora's watch view keeps video playback visible and official by design.

---

## 4. Sonora current state vs. feature gap matrix

Legend: **✅ Implemented & tested** · **🟡 Implemented, live-verification pending** · **🧩 Partial** · **❌ Missing — worth the MVP** · **⛔ Out of scope for the web MVP** · **⏸ Deferred** (real, but below the top five)

| Capability (seen in references) | Sonora status | Evidence / notes |
|---|---|---|
| Language-filtered search, default `All languages` / `All sources` | ✅ | `languages.ts`, `sources.ts`, `search-filters.test.ts`, `catalog-facade.test.ts`; URL-shareable `?lang=&src=` |
| Multi-source search with per-source failure isolation | ✅ | `searchGrouped()` + grouped UI; outage tests (Audius down, demo survives; Jamendo error group) |
| Demo fallback that can never break | ✅ | facade fallback tests; e2e credential-less build |
| Direct-audio player: queue (play-next/reorder/remove/clear), shuffle w/ base-order restore, repeat, seek, volume/mute, autoplay-block handling | ✅ | `engine/player.ts`, `player.test.ts` |
| Session + queue restore across reloads (paused) | ✅ | `SessionState {songIds,index,positionMs,contextLabel}` in `prefs-store.ts`, restored in `shell.ts` |
| Keyboard shortcuts (space, seek arrows, volume, next/prev, shuffle, repeat, queue, `/`, Esc) | ✅ | `shell.ts` `onKey`; e2e `/` shortcut test |
| Favorites, user playlists CRUD + reorder, recently played, recently added | ✅ | `library-store.ts` (localStorage + `pagehide` flush), `library-store.test.ts` |
| Time-synced lyrics rendering | ✅ (5 demo tracks) | `Song.lyrics` (`LyricLine[]`), `ui/lyrics.ts` syncs to player position |
| Audius integration | ✅ live-verified | `smoke:audius` report; unit suites |
| Jamendo integration (search, entities, CC attribution, source badge) | 🟡 | Committed, unit-tested; live smoke **failed** (docs' test id suspended) — `replica/jamendo-smoke-report.json` is honest |
| MusicKit search plumbing | 🟡 | Mock-tested; no credentials (tracked in `replica/musickit-milestone.md`, out of this plan's scope) |
| YouTube discovery + visible official-embed playback | 🟡 | **M2 implemented:** wired into `availableSources()`/`providerInfos()` when `VITE_YOUTUBE_API_KEY` is set; dedicated `?src=youtube` view + `/watch/:id` (deliberately **never aggregated into `All sources`** — conservative reading of policy III.E.2/III.C.5, README "Dedicated view, never blended"); keyless contracts asserted in `catalog-facade.test.ts` + 5 new e2e tests; new `youtube-{config,client,normalize,provider,embed}.test.ts` suites; `.env.example` + Pages vars document the key. Committed as `feat: add compliant YouTube watch experience` after a full local review. Live with-key search unverified (no key in this environment); keyless playback/watch contracts verified offline. |
| Explicit badge, source badge, CC licence line | ✅ | `media.ts`, `song.ts`, tests |
| Radio (stations) | ✅ (demo stations) | `views/radio.ts` over demo catalogue |
| E2E suite | ✅ 17 tests | `tests/e2e/app.spec.ts` (12 original + 5 YouTube/keyless-watch); **run in CI since M1** |
| Lyrics for remote (Audius/Jamendo) tracks | ❌ | No lyrics provider; renderer ready |
| OS media controls (lock screen, media keys, Bluetooth) | ❌ | No `navigator.mediaSession` usage anywhere |
| Listening history view + listening stats | ❌ | Data exists (`recentlyPlayed`, capped 40) but only as an implicit library section; no view, no stats (nuclear ships both) |
| E2E as a merge/deploy gate in CI | ✅ | Pages workflow runs `npm run test:e2e` before the deploy build (M1, run 40087077118 green; a deliberately failing E2E proven to block deploy) |
| Scrobbling (Last.fm et al.) | ⏸ | Needs external API key + account — credentials burden |
| UI internationalization (translations) | ⏸ | English-only UI; content-language filtering ≠ UI locale; string-extraction pass is a large lift |
| Playlist import/export (+ smart playlists) | ⏸ | Natural follow-on once M5 stats/history data exists (nuclear/koel pattern) |
| Recent searches / suggestions | ⏸ | Small UX nicety (nuclear has recent searches) |
| Crossfade, gapless, equalizer, normalisation, sleep timer, skip-silence | ⏸ | Web Audio complexity vs. MVP value; refs are native apps |
| Offline downloads / caching of audio | ⛔ | Browser/CORS constraints; refs' download features are native and ToS-sensitive here |
| Accounts, sync server, multi-user, SSO (Koel Plus), WebDAV (Any Listen) | ⛔ | Sonora is a static GitHub Pages app by design |
| "Listen together", phone remote (Nuclear Jam), widgets | ⛔ | Requires a backend |
| Plugin marketplace, MCP server, AI assistants/translations | ⏸ | No current extension need for a framework-free MVP |
| Live radio streams / podcasts (koel) | ⛔ | Source rights risk; not needed for MVP |
| Native packaging (all references are desktop/mobile) | ⛔ | Sonora stays a web app on Pages |

---

## 5. Prioritized MVP roadmap (5 milestones)

Each milestone is designed as **one small, independently testable OpenCode task**: implement → run the five gates (`lint`, `typecheck`, `test`, `build`, `test:e2e`) → review → commit. They do not depend on each other except where noted, and none may disturb the protected YouTube/watch work beyond what its own milestone explicitly states.

### M1 — Release-gate hardening: run E2E in CI (smallest, reliability first)

- **User benefit:** a UI regression can no longer reach the live Pages deployment; deploys become trustworthy. Jamendo's honest verification status is re-checked if a client id becomes available.
- **Code areas:** `.github/workflows/deploy-pages.yml` (insert `npx playwright install --with-deps chromium` + `npm run test:e2e` **after** `npm run build`, before `cp dist/...`/deploy; job-level `timeout-minutes`); optional `replica/jamendo-smoke-report.json` regeneration **only if** a working `VITE_JAMENDO_CLIENT_ID` exists (env-only, never committed); optional one-line README note ("E2E runs in CI"). No `src/` changes.
- **Dependencies/credentials:** none required. Optional: free Jamendo client id from devportal.jamendo.com for a smoke rerun (`VITE_JAMENDO_CLIENT_ID=… npm run smoke:jamendo`).
- **Risks/fallbacks:** browser install flakiness in Actions → pin Playwright version already in `devDependencies`, use `--with-deps`, single retry allowed by workflow; if E2E proves unstable in CI, the workflow change is itself one commit that can be reverted to the current unit-only gate — deploy functionality never depends on M1 remaining.
- **Acceptance criteria:** every push shows steps lint → typecheck → unit → build → **E2E (12/12)** → deploy; a deliberately failing E2E blocks deployment (verified once via a throwaway branch/PR).
- **Tests:** the existing 12 Playwright tests are the gate (no new tests required for this milestone); failure-path check as above.
- **Definition of done:** Actions run green with the E2E step; workflow diff reviewed; README verification line updated if the Jamendo rerun happened (otherwise its "unverified" status stands unchanged).

### M2 — Land the YouTube/watch vertical slice (distinct playback path)

*Prerequisite: none technically, but this milestone **starts by committing the existing protected work** exactly as the Jamendo commit pattern taught (partial staging of shared files, YouTube hunks excluded/staged deliberately, all gates green) — then builds the wiring on top as a second commit. It does not rewrite the existing files.*

- **User benefit:** completes the source matrix with a multilingual, legitimately-embeddable source; users without a key keep an app that is honest and unchanged; with a free key, search results gain YouTube rows that play in the visible official embed (audio engine untouched).
- **Code areas:** review/commit the existing `src/data/youtube-{client,config,normalize,provider}.ts`, `src/ui/youtube-embed.ts`, `src/views/watch.ts`, and the `router.ts`/`shell.ts`/`types.ts` hunks; then `src/data/catalog.ts` (youtube branch in `runSource`, `availableSources()` when configured, `flattenGrouped` position per `SOURCE_ORDER`, `providerInfos()` + `unavailableGroup` unconfigured/disabled messaging), `.env.example` (`VITE_YOUTUBE_API_KEY` documentation — public, referrer-restricted), `deploy-pages.yml` vars passthrough, README provider section; **new** `tests/unit/youtube-{config,client,normalize,provider}.test.ts` + facade cases in `catalog-facade.test.ts` + e2e additions.
- **Dependencies/credentials:** optional free **YouTube Data API v3** key (Google Cloud console, enable API, restrict key by HTTP referrer). Free tier = 100 `search.list`/day (the client already sends `maxResults=10` + one cheap `videos.list` per search). **Playback via the official iframe needs no key.** Credential-less builds: source absent from the selector, `?src=youtube` → honest `unconfigured` group naming the env var, **zero requests** (mirrors Jamendo's contract).
- **Risks/fallbacks:** quota exhaustion → typed `quota` error surfaces as a per-source error group (client codes already exist); key misuse → referrer restriction (documented); per-video embed restrictions → `videoEmbeddable=true` filtering plus watch-page external-link fallback already designed into `watch.ts`; regression to the audio path → all existing suites must stay green; audio/video overlap → `/watch` pauses the engine and shell destroys the embed on navigation (existing design, must be test-locked).
- **Acceptance criteria:** (a) without key: selector omits YouTube, shared `src=jamendo`-style URL for youtube shows the unconfigured notice, zero requests, `src=youtube` never appears in `availableSources()`; (b) with key: search shows a YouTube group with source badge, rows are `yt-*` ids, clicking navigates to `/watch/:id` rendering the official iframe, audio engine paused, Back/leave destroys the embed; (c) Audius/demo/Jamendo paths byte-for-byte unaffected (existing 240 unit + 12 e2e green); (d) `playbackKind: 'youtube'` never enters the `<audio>` queue path.
- **Tests:** *Unit* — client: request params (`part=snippet`, `type=video`, `videoEmbeddable=true`, `maxResults=10`, `relevanceLanguage` when language selected, `key` param), quota/forbidden/500 error mapping, TTL cache; config: key present/absent/`VITE_YOUTUBE_ENABLED=0`, `describeYoutubeConfig()` message contains `VITE_YOUTUBE_API_KEY`; normalize: `yt-<id>` ↔ videoId round-trip, `youtubeWatchUrl`, `playbackKind:'youtube'`, no-audio-URL guarantees; provider: entity routing + unsupported surfaces (`getPlaylist`/`getGenre` → null, zero fetches when unconfigured); facade: youtube group ordering/flatten, unconfigured isolation (zero fetch), language gating (`other` hides youtube). *E2E* — credential-less build: youtube absent from source selector (new assertions); mocked `page.route` for `www.googleapis.com/youtube/v3/*`: watch route renders embed shell + Back button + engine paused, and existing playback tests unchanged.
- **Definition of done:** all five gates green; two clean commits (land existing work, then wiring+tests) following the established Jamendo-commit discipline; README + `.env.example` document the key; live with-key verification performed **or** explicitly recorded as not verified (quota/key availability may block it — honesty over claims).

> **Status (2026-10-24): implemented, gates green, committed as
> `feat: add compliant YouTube watch experience`.**
> lint · typecheck · unit **307/307** · build · e2e **17/17** all pass locally.
> Deviations from the text above: (1) the *commit-first* sequencing was
> replaced by review-first — the slice was finished and gated in a
> review-ready working tree, then committed as a single commit after the
> reviewer's gate re-run (no history rewritten); (2) YouTube is deliberately excluded from
> `All sources` aggregation (conservative reading of policy III.E.2/III.C.5 —
> README "Dedicated view, never blended"); (3) the embed wrapper was extended
> with ready-gating, player state/error events, and made-for-kids →
> privacy-enhanced (nocookie) embedding per III.E.4.j. Acceptance (a) and
> (d) are fully proven (keyless contracts + engine queue-guard tests); live
> with-key acceptance (b) remains **unverified — no API key in this
> environment** (recorded in README/Limitations rather than claimed).

### M3 — Synced lyrics for remote tracks (LRCLIB, fallback-first)

- **User benefit:** the lyric experience today reserved for 5 demo tracks extends to Audius/Jamendo (and later YouTube) tracks — in many languages — the single most "player-like" gap versus all six references.
- **Code areas:** new `src/data/lrclib-client.ts` (typed fetch: `GET /api/get` with `track_name`/`artist_name`/`album_name`/`duration`, fallback `GET /api/search`; 4s `AbortSignal`; user-agent/`Lrclib-App-Id` header if adopted), new pure `src/utils/lrc.ts` (LRC parse: `[mm:ss.xx]`/`[mm:ss]`, multiple timestamps per line, ignore-metadata tags), `src/ui/lyrics.ts` (prefer embedded `song.lyrics`, else async provider fill; existing empty state on failure), thin `src/state/lyrics-cache.ts` or localStorage map keyed by songId with **negative caching** for the session, attribution string if LRCLIB terms require it (see §8). `src/domain/types.ts` gains nothing — `Song.lyrics?: LyricLine[]` already exists.
- **Dependencies/credentials:** none (key-less, anonymous access documented; optional public `Lrclib-App-Id` later for higher limits). Network only when a track with no embedded lyrics opens the Lyrics panel.
- **Risks/fallbacks:** API down/503 (observed during this audit) → single attempt, no retry storm, existing "no lyrics" empty state; 404 → negative-cache for session; rate limit (429) → backoff, negative-cache; **CORS unknown from a browser (§8)** → if blocked, milestone is re-scoped immediately rather than shipped with hacks; terms/attribution unverified → contract behind a one-method interface so the provider can be swapped or disabled without touching the UI; playback never waits on lyrics.
- **Acceptance criteria:** a Jamendo/Audius track with an LRCLIB match shows lines that highlight in sync with elapsed time in Now Playing → Lyrics; non-matching tracks show the existing honest empty state; demo tracks use embedded lyrics with **zero** network calls (assert via spy); repeat open of the same track is served from cache (fetch count unchanged); offline playback unaffected.
- **Tests:** *Unit* — LRC parser (timestamps, offsets, malformed lines, CRLF), client (duration-tolerance matching, search fallback, 404/429/503/timeout/abort, negative cache), preference logic (embedded wins; cache hit; failure → null not throw). *E2E* — Playwright `page.route('**/lrclib.net/**', …)` mocked success: assert a highlighted line advances with the player progress; route aborted: assert empty state renders and no page errors; existing lyrics tests unchanged.
- **Definition of done:** gates green; terms verified and attribution implemented (or milestone blocked, see §8); README "Lyrics" bullet updated (source + honest coverage claim); no `src/` file outside the listed areas touched.

### M4 — Media Session API (OS media keys / lock screen)

- **User benefit:** Sonora behaves like a native player on desktop and mobile — media keys, notification/lock-screen controls, Bluetooth play/pause — a direct nod to Metrolist's background-playback controls and sonorahq's native transport, implemented the web-platform way.
- **Code areas:** new `src/engine/media-session.ts` (feature-detect `navigator.mediaSession`; `setMetadata` on track change — title, artist, album, absolute artwork URLs (remote `artworkUrl` or same-origin `album-<seed>` art); register `play`/`pause`/`previoustrack`/`nexttrack`/`seekto`/`seekbackward`/`seekforward`/`stop` handlers mapped 1:1 to existing `player` methods; clear metadata on stop/empty queue); single init call from `src/app/shell.ts` (or player bootstrap). No CSS, no view changes.
- **Dependencies/credentials:** none. Pure browser platform API.
- **Risks/fallbacks:** partial/absent support → guard makes the whole module a no-op (today's UX unchanged); artwork must be absolute URLs → normalize at the boundary; double-registration on re-init → idempotent init; jsdom has no `mediaSession` → tests inject a stub (same discipline as `fixtureFetch`).
- **Acceptance criteria:** on supported browsers, changing tracks updates lock-screen/notification metadata; invoking any registered action handler drives the engine identically to the in-app button; in an environment without `navigator.mediaSession`, app boots with zero errors and identical behavior; no duplicate handlers after SPA navigation.
- **Tests:** *Unit* — metadata written on song change (incl. absolute artwork), each handler maps to the expected engine call, absent-API no-op, idempotent init, cleared on stop. *E2E (optional, if stable in Chromium)* — after playback starts, `navigator.mediaSession.metadata` is non-null and `pause` action pauses the player; otherwise unit-only plus a manual device check recorded honestly.
- **Definition of done:** gates green; behavior unchanged where unsupported (existing suites prove it); README gains a one-line feature bullet; manual OS-key verification performed **or** marked unverified.

### M5 — Local listening history + stats (persistence depth)

- **User benefit:** "what did I just hear / what do I play most" — the history/stats pair nuclear and koel both ship — using data Sonora already persists, entirely local and private (a deliberate contrast to the reference projects' server or telemetry models).
- **Code areas:** `src/state/library-store.ts` (raise/сап history cap with pruning — e.g. keep 200 entries, dedupe by songId recency — plus `clearRecentlyPlayed()`; keep the `pagehide` flush), new pure `src/utils/stats.ts` (derive top tracks/artists over a window from `recentlyPlayed`), `src/views/library.ts` (new "History" tab: chronological rows reusing `songRowHtml`, play-from-here via existing queue actions, Clear button with confirm-less toast; "Stats" panel: top 5 tracks + top 5 artists last 30 days with counts), `src/ui/media.ts` only if a tiny shared row variant is needed. No router changes (library is already a tabbed route).
- **Dependencies/credentials:** none.
- **Risks/fallbacks:** localStorage growth → hard cap + prune (tested); songs missing from the remote registry after provider changes → resolve best-effort via `getSong`, drop unresolvable rows without crashing (the facade's null-safety already guarantees this); timezone/bucketing edge cases → all math on absolute `at` timestamps; ties → stable deterministic order for testability.
- **Acceptance criteria:** playing tracks creates History entries newest-first with correct titles/artists; Clear empties it and the empty state persists across reload; stats counts match played entries within the window; favorites/recently-added tabs behave exactly as before; corrupt storage (garbage JSON) loads without throwing.
- **Tests:** *Unit* — stats derivation (counts, window boundary, ties, empty, single), cap+prune behavior, clear action + persistence round-trip, corrupt-state parse guard. *E2E* — extend the existing playback test: play a track → Library → History shows the entry → Clear → empty state (then reload-persistence covered by unit tests).
- **Definition of done:** gates green; README library bullet extended; no changes to player/queue/routing semantics.

**Suggested sequencing:** M1 → M2 → M3 → M4 → M5 (reliability first; then land and protect in-flight work; then player experience; then persistence depth). M3–M5 are order-independent if priorities shift.

---

## 6. Explicitly deferred

- **Scrobbling (Last.fm/ListenBrainz)** — external key + user account; revisit after M5 provides play history to batch from.
- **UI internationalization** — valuable (every reference translates) but a string-extraction lift across all views; Sonora's multilingual story for the MVP is *content-language* filtering, which already exists.
- **Playlist import/export and smart playlists** — natural M6 candidates once M5 stats exist (nuclear/koel patterns); persistence-wise M5 ships first.
- **Recent searches / query suggestions** — small UX nicety (nuclear has recent searches).
- **Sleep timer, crossfade, gapless, equalizer, audio normalization, skip-silence** — Web Audio engineering with browser limits; the references are native apps.
- **Offline downloads / audio caching** — native-app feature; browser constraints and ToS sensitivity; not needed for the demo-scale catalogue.
- **Plugin platforms, MCP server, AI lyrics/assistants** (nuclear, pear, koel, Metrolist AI translation) — no current extension demand; external services.
- **"Listen together", phone remote, home-screen widgets** — require a backend Sonora deliberately does not have.
- **Accounts, sync servers, WebDAV, multi-user/SSO** (Koel Plus, lx-music sync, Any Listen) — static-hosting model.
- **Live radio streams and podcasts** — catalogue-rights questions outside the MVP's safe sources.
- **Native packaging** — all six references are desktop/mobile; Sonora stays a web app.
- **MusicKit live verification** — already tracked separately in `replica/musickit-milestone.md`; not re-planned here.
- **Any source-code reuse from GPL/AGPL projects** — deferred indefinitely pending explicit approval and a licence-compliance plan.

---

## 7. Sources (reviewed 2026-10-24)

| Source | What was read | URL |
|---|---|---|
| sonorahq/sonora | GitHub repo page, README (raw), `COPYING` text, GitHub API metadata | https://github.com/sonorahq/sonora |
| MetrolistGroup/Metrolist | Repo page (via API), README (raw), `LICENSE` text, GitHub API metadata | https://github.com/MetrolistGroup/Metrolist |
| nukeop/nuclear | Repo/API metadata, README (raw), `LICENSE` text, `CONTRIBUTING.md` (fetched) | https://github.com/nukeop/nuclear |
| koel/koel | Repo/API metadata, README (raw), `LICENSE.md` text | https://github.com/koel/koel |
| lyswhut/lx-music-desktop | Repo/API metadata, README (raw, Chinese), `LICENSE` text | https://github.com/lyswhut/lx-music-desktop |
| pear-devs/pear-desktop | Repo/API metadata, README (raw), `license` file text | https://github.com/pear-devs/pear-desktop |
| LRCLIB API docs | Search-indexed documentation excerpts (SPA; direct render empty) | https://lrclib.net/docs |
| LRCLIB live probes | Two anonymous calls: `GET /api/get` → `404 TrackNotFound`; `GET /api/search` → `503 ServerOverloaded` (service live, overload protection active) | https://lrclib.net/api/get · https://lrclib.net/api/search |
| Sonora (this repository) | Local source inspection at `d95a7f4` + protected uncommitted work: `package.json`, `src/data/*`, `src/engine/player.ts`, `src/state/*`, `src/views/*`, `src/app/*`, `src/ui/*`, `tests/*`, `.github/workflows/deploy-pages.yml`, `.env.example`, `replica/*` | https://github.com/chanukyareddygopala07/apple-music-replica |
| Sonora production | Listed production URL (not re-verified in this audit) | https://chanukyareddygopala07.github.io/apple-music-replica/ |

---

## 8. Uncertainty — what could not be verified

1. **No reference source code was inspected.** Every feature claim above is README/docs-level. Architecture statements (nuclear's plugin internals, koel's smart-playlist mechanics, Metrolist's extractor details, pear's YouTube internals, lx's source model) are inferred from their documentation, not code.
2. **Reference test suites were not verified.** Seen: nuclear's documented `pnpm test/lint/type-check`, koel's unit-test Actions badge + Scrutinizer badge, pear's Playwright note. Not seen: sonorahq/sonora's, Metrolist's, or lx-music's actual test workflows (badges/file listings only).
3. **LRCLIB terms and browser behavior:**
   - The docs page is a JavaScript SPA; only search-engine-indexed excerpts were readable. The **database/content licence and attribution requirements were not read** — M3 must verify them before implementation ships.
   - **CORS from a browser was not tested** (probes were server-side curl). If LRCLIB does not send CORS headers, M3 must be re-scoped (see M3 fallback).
   - Rate-limit numerics are undocumented in what was read ("generous"); one `503 ServerOverloaded` was observed live, so capacity risk is real.
   - Optional `Lrclib-App-Id` registration flow exists (public id, email-code login) — details beyond indexed excerpts unverified.
4. **Jamendo live verification remains failed/unverified** (test client id suspended as of 2026-10-24). Whether Jamendo issues new ids to anonymous registrants was not tested. M1 may re-run the smoke but must not assume success.
5. **YouTube Data API key acquisition and quota for Sonora's use** (100 searches/day on the free tier) was not exercised — M2's live acceptance depends on obtaining a key; the milestone's credential-less acceptance criteria do not.
6. **Name collision:** `sonorahq/sonora` is a different product entirely; nothing in this plan assumes shared ancestry with this repository.
7. **pear-desktop lineage:** the `th-ch` copyright in its license file suggests derivation from `th-ch/youtube-music`; the fork relationship was not confirmed beyond that line.
8. **Sonora production environment** was not re-audited in this run; claims about the deployed app rest on the local gates (240 unit / 12 E2E / build green at `d95a7f4`).
9. **CI behavior of M1** (Playwright in GitHub Actions timing/flakiness) is predicted from the local setup, not yet demonstrated in Actions.
