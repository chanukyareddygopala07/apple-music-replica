# Apple MusicKit integration — milestone plan (M1–M5)

Status: **approved plan — M1 implemented** (secure token plumbing +
conditional initialization; credential-less gates extended to 89 unit / 11
e2e). Live MusicKit initialization is **not yet verified** (blocked on
external prerequisites, see §5 M1). M2–M5 not implemented. The demo player
remains the default and only playback path.

Companion docs: `replica/recon.md`, `replica/build-log.md`, `../../README.md`.

---

## 1. Goals and non-goals

**Goals**

- Optional, official Apple Music integration (catalogue search/details,
  user authorization, streaming) using Apple's current MusicKit on the Web +
  Apple Music API, behind credentials the operator supplies.
- Zero regression for the credential-less product: demo playback, queue,
  favorites, playlists, keyboard shortcuts, and all tests keep working with no
  token and no MusicKit script loaded.

**Non-goals (this plan)**

- Implementing any of M1–M5 now.
- Accounts/sync, Android/iOS native apps, AirPlay, DRM outside MusicKit.
- Claiming MusicKit streaming works before it has been tested with real
  credentials (README already states this; keep it accurate).

**Hard security rules (apply to every milestone)**

1. The MusicKit `.p8` private key exists **only** on the separate
   token-signing server (a private repo/service outside this repository),
   loaded from its own environment/secret store. It is never copied into this
   repo, this repo's CI, screenshots, logs, or docs.
2. This repo may hold only non-secret configuration: a token-server URL, an
   enable flag, and (optionally, local dev only) a short-lived token in
   `.env`, which is git-ignored (`.env.example` stays placeholder-only).
3. Never commit real credentials, tokens, keys, or `.env` files — enforced by
   `.gitignore` (`.env`, `.env.*`, `!.env.example`) and a secret scan of every
   staged diff before commit.

---

## 2. Prerequisites (outside this repository)

| # | Prerequisite | Where it lives | Notes |
| --- | --- | --- | --- |
| P1 | Apple Developer Program membership | Apple account | Required for media identifiers/keys (Account Holder/Admin role for key creation). |
| P2 | Media identifier (reverse-domain style name, services enabled) | Apple Developer portal | Per Apple's "Create a media identifier and private key" help doc. |
| P3 | MusicKit private key (`.p8`) + key id (`kid`) | **Token-signing server only** | Up to 2 keys per media identifier; revocable if compromised. |
| P4 | Token-signing service (separate, private) | Own repo/server | Signs ES256 JWTs with Team ID (`iss`), `kid`, `iat`, `exp`; returns short-lived tokens over HTTPS. Never ships the key to clients. |
| P5 | Token-server endpoint URL for this app | `.env` (git-ignored) | e.g. `VITE_MUSICKIT_TOKEN_URL`. A URL is not a secret; the token it returns is short-lived. |

---

## 3. Documentation verification (performed 2026-10-24)

Checked against current official Apple sources before writing this plan:

| Source | What it establishes |
| --- | --- |
| Apple Music API — [Generating Developer Tokens](https://developer.apple.com/documentation/applemusicapi/generating-developer-tokens) | Developer token = JWT signed **ES256** only; header `kid` (10 chars); claims `iss` (Team ID), `iat`, `exp` ≤ 15777000 s (6 months); **`origin` claim optional but recommended for web clients** (JWT only accepted when the request's Origin header matches a listed value); requests can return `429` rate-limit errors. |
| Apple Account Help — [Create a media identifier and private key](https://developer.apple.com/help/account/configure-app-capabilities/create-a-media-identifier-and-private-key/) | Register a Media ID (reverse-domain **naming convention**), enable services, create/associate a private key, obtain `kid`, then sign tokens. **No domain-ownership or TLS-verification step is documented.** |
| Apple Music API — [User Authentication for MusicKit](https://developer.apple.com/documentation/applemusicapi/user-authentication-for-musickit) | Subscriber-specific data needs a **Music User Token**; MusicKit on the Web decorates requests with it automatically after user authorization. |
| [MusicKit on the Web — Getting Started](https://developer.apple.com/musickit/web) | A signed developer token is required to initialize MusicKit on the Web; the MusicKit global loads asynchronously from Apple's CDN. |

**Finding on domain verification:** current official documentation does **not**
state that MusicKit on the Web requires registering or verifying a domain, nor
a TLS-trust configuration, as a precondition for developer tokens or
authorization. The only web-origin control documented is the *self-asserted*
`origin` claim inside the developer token. Therefore domain verification is
recorded as an **open question (§8)**, not an established blocker. (An earlier
informal assumption that a custom domain would be mandatory for `*.github.io`
hosting was **not** supported by these sources and is explicitly retracted
pending empirical testing in M1.)

---

## 4. Architecture: `PlaybackBackend`

Today `PlayerEngine` (`src/engine/player.ts`) owns both the **queue brain**
(queue, shuffle base order, repeat, snapshot/subscription, persistence hooks)
and the **audio transport** (one `HTMLAudioElement`). The transport is the only
part that differs between demo and MusicKit, so it gets extracted behind an
interface. This is the load-bearing design decision of M3.

```ts
/** Transport-level contract: plays ONE current source at a time.
 *  Queue, shuffle, repeat, favorites, and persistence stay in PlayerEngine. */
export type PlaybackSource =
  | { kind: 'demo'; songId: string; url: string }        // HTMLAudioElement path
  | { kind: 'catalog'; songId: string; catalogId: string } // MusicKit path

export interface PlaybackBackend {
  readonly kind: 'demo' | 'musickit'
  load(source: PlaybackSource): void
  play(): Promise<void>
  pause(): void
  seekTo(ms: number): void
  setVolume(volume: number): void
  setMuted(muted: boolean): void
  positionMs(): number
  durationMs(): number
  /** Subscribe to transport events; returns unsubscribe. */
  on(event: 'timeupdate', listener: (ms: number) => void): () => void
  on(event: 'durationchange', listener: (ms: number) => void): () => void
  on(event: 'ended', listener: () => void): () => void
  on(event: 'error', listener: (message: string) => void): () => void
  destroy(): void
}
```

**Coexistence rules**

| Concern | Owner after M3 | Why UI/tests don't break |
| --- | --- | --- |
| Player bar, transport buttons, progress slider | `PlayerSnapshot` subscribers (unchanged) | Backends emit into the same snapshot shape (`status`, `positionMs`, `durationMs`, `error`, `blocked`, …). |
| Queue, shuffle, repeat, enqueue/remove/move, session restore | `PlayerEngine` (unchanged logic) | Engine stays backend-agnostic; it calls `backend.load/play/pause/seekTo` only. |
| Keyboard shortcuts, `data-action` bindings, views | Unchanged | They call `PlayerEngine` methods, never touch `Audio` or MusicKit directly. |
| Backend selection | Boot time, one active backend | Default `DemoBackend`. `MusicKitBackend` activates only when the enable flag is set **and** a developer token was obtained **and** MusicKit configured successfully. No mid-session switching in v1. |
| Test construction | Constructor injection | `new PlayerEngine(backend?: PlaybackBackend)` defaults to `DemoBackend`, so `tests/unit/player.test.ts` and every credential-less suite keep passing unmodified; MusicKit backend tests inject a fake MusicKit player. |

```ts
// src/engine/player.ts (M3 sketch — not implemented now)
export class PlayerEngine {
  constructor(private readonly backend: PlaybackBackend = new DemoBackend()) { … }
}
export const player = new PlayerEngine() // single export unchanged
```

`MusicKitBackend.load({ kind: 'catalog', … })` maps to MusicKit's player
(`music.play()` with a catalog resource); its `timeupdate`/`ended`/`error`
events map onto the interface. Demo sources with `kind: 'catalog'` (or a
backend mismatch) must fail soft: set `snapshot.error`, keep the queue
intact — never throw into the UI.

---

## 5. Milestones

Each milestone is a separate PR/commit series with its own acceptance criteria
and a green quality-gate run. Nothing merges if credential-less gates regress.

### M1 — Token plumbing (no UI change)

**Status: implemented in this repo (commit `feat: add secure MusicKit token
plumbing`) — live acceptance criterion blocked on external prerequisites.**

- **Work:** build/stand up the token-signing service (P4) holding the `.p8`;
  this repo gains runtime token acquisition (`VITE_MUSICKIT_TOKEN_URL` or
  local-dev `VITE_MUSICKIT_DEVELOPER_TOKEN` in git-ignored `.env`), an
  explicit `VITE_MUSICKIT_ENABLED` flag, and activation wiring in the existing
  `musickit-provider` (search-only, as today). Include the recommended `origin`
  claim listing the site origin. Optionally add a secret-scan CI step.
- **Depends on:** P1–P5.
- **Delivered in this repo:**
  - `src/data/musickit-token.ts` — two-key gate
    (`VITE_MUSICKIT_ENABLED` + token source); token-service fetch returning
    JSON `{ "token" }` (alias `{ "developerToken" }`); JWT shape and `exp`
    validation (expired tokens rejected before use); cache refresh 60s before
    expiry (open question §8.3: short-lived signer policies will naturally
    refetch every time); 5-minute fallback TTL when `exp` is unreadable;
    single-flight fetches; 8s request timeout; HTTP status, network,
    malformed-JSON, missing/malformed-token errors as typed `TokenError`s
    whose messages never contain token material, response bodies, or headers.
  - `src/data/musickit-provider.ts` — gate checked **before any network
    activity**; token fetched **before** the CDN script is injected (a failing
    token service produces zero MusicKit requests); single-flight SDK loader
    that short-circuits when `window.MusicKit` already exists; on
    `configure()` rejection with a dynamic source: one forced token refresh
    + one retry (static local-dev tokens do not retry); `init()` never throws
    (resolves null → catalogue facade falls back to demo); Settings
    descriptions via `describeMusicKitConfig` (never include tokens).
  - `.env.example` + README document the public config, the signing service
    as the only `.p8` holder, and the honest verification status.
- **Acceptance criteria — actual results:**
  1. **NOT MET — blocked.** Live `musickit.configure()` + catalog search with
     a real token could not be run: no Apple Developer Program credentials,
     media identifier, `.p8`, or token-signing service exist in this
     environment (external prerequisites P1–P4; only the public browser-side
     URL config `VITE_MUSICKIT_TOKEN_URL`/`VITE_MUSICKIT_ENABLED` belongs in
     this repo, per hard rule 1–2). **No live MusicKit initialization is
     claimed anywhere in this repo's docs.** The §8.1 domain/origin empirical
     question therefore also remains open — settled only when a real signer
     can issue a token for testing.
  2. **MET.** With no env vars: demo behavior unchanged; no MusicKit CDN
     script, no `window.MusicKit`, no token fetch (unit: credential-less
     provider/facade tests asserting zero `fetch` and zero script injection;
     e2e: `credential-less build never contacts MusicKit…` asserts zero
     `music.apple.com` requests across home + search, no CDN script, no
     MusicKit global on the built preview).
  3. **MET.** Staged-diff secret scan clean (no tokens/keys/bodies); quality
     gates green: lint, typecheck, **89/89 unit (+42)**, **11/11 e2e (+1)**,
     production build.
- **Remaining blockers:** (a) external prerequisites P1–P4 — Apple Developer
  Program membership, media identifier + `.p8`/`kid`, and a deployed
  token-signing service (the precise missing pieces for criterion 1);
  (b) one live session against that service to settle §8.1 (domain/origin on
  `*.github.io`) and §8.3 (real token lifetimes vs. the refresh margin);
  (c) secret-scan CI step still optional/not added (manual staged-diff scan
  performed instead).

### M2 — User authorization

- **Work:** `MusicKit.getInstance().authorize()` popup flow; sign-out;
  "Sign in to Apple Music" entry in the user menu; explicit states for
  not-signed-in, signed-in-without-subscription, and auth errors (toast, no
  dead UI). Music User Token management stays inside MusicKit JS (automatic
  per Apple docs).
- **Depends on:** M1.
- **Acceptance criteria:**
  1. With credentials, a subscriber can authorize and sign out; state is
     visible in the UI and survives reload.
  2. Without credentials or when the user declines, the app is fully usable
     and shows no errors beyond an informational toast.
  3. Credential-less unit/e2e suites green (auth code paths covered by mocks).

### M3 — `PlaybackBackend` extraction (pure refactor + dormant MusicKit shell)

- **Work:** extract `PlaybackBackend` + `DemoBackend` from `PlayerEngine` with
  **zero behavior change**; add `MusicKitBackend` skeleton behind the flag;
  constructor injection; contract tests for the interface run against
  `DemoBackend` and a fake MusicKit backend.
- **Depends on:** nothing (can start immediately; no credentials needed).
- **Acceptance criteria:**
  1. `git diff` shows no intentional behavior change: player bar, queue
     panel, keyboard shortcuts (Space/←→/↑↓/M/N/P/S/R/Q//Escape), session
     restore, and autoplay-block handling behave identically.
  2. Full gate suite green **unmodified** (`npm run lint`, `npm run typecheck`,
     `npm test`, `npm run test:e2e`, `npm run build`).
  3. Default boot path still constructs `DemoBackend` only.

### M4 — Catalogue enrichment + MusicKit streaming

- **Work:** complete `MusicKitBackend` transport; enrich search/album/artist/
  song pages from Apple Music when authorized (demo fallback preserved,
  content-source clearly badged); route queue items with catalog IDs through
  the MusicKit backend; map MusicKit errors to `snapshot.error`/`blocked`.
- **Depends on:** M1, M2, M3.
- **Acceptance criteria:**
  1. With credentials + authorized subscriber: search returns Apple Music
     catalogue results; a catalog song streams; play/pause/seek/next/previous/
     queue/skip work with the player bar and Now Playing unchanged.
  2. Without credentials: identical behavior to today (demo catalogue, demo
     audio, zero MusicKit network calls).
  3. Rate-limit (`429`) and "no subscription" responses degrade gracefully to
     demo content with a user-visible message.
  4. All quality gates green in both modes.

### M5 — Verification, honesty, and release gates

- **Work:** mock-MusicKit unit tests; a written manual test matrix run with
  real credentials (authorize, stream, offline/429/subscription-missing
  cases); README/build-log claims updated to match *tested* behavior only;
  review Apple Developer Program License Agreement MusicKit terms before any
  public streaming deployment; optional secret-scan CI hardening; rollback
  drill (§7) executed and recorded.
- **Depends on:** M1–M4.
- **Acceptance criteria:**
  1. Full gate suite green with no credentials (CI state) — same commands as
     today, no skips, no `@ts-ignore`/eslint-disable introduced.
  2. With credentials, the manual matrix passes and produces evidence
     (screenshots/smoke report under `replica/`).
  3. README limitations section states exactly what was and wasn't tested;
     no claim of "Apple Music streaming works" without the M5 evidence.
  4. Rollback drill: unsetting the flag/env returns the deployed site to
     pure demo mode with no residual MusicKit requests.

---

## 6. Test strategy (credential-less stays green throughout)

- **Unit (Vitest, 47 tests today):** existing suites untouched by M1–M2; M3
  adds backend contract tests (fake audio, fake MusicKit player); no network,
  no Apple CDN, no tokens — runs in CI exactly as today.
- **E2E (Playwright, 10 tests today):** CI has no `VITE_MUSICKIT_*` env, so
  suites exercise the demo backend only — this is also a regression guard that
  MusicKit never activates silently. MusicKit-specific e2e (if added in M5)
  must live in a separate spec gated on credentials being present locally,
  never in CI.
- **Gates (run before every milestone merge):**
  `npm run lint && npm run typecheck && npm test && npm run build && npm run test:e2e`
  plus a staged-diff secret scan.
- **Invariant:** adding `MusicKitBackend` must not add unconditional
  `js-cdn.music.apple.com` script tags; the CDN script loads only after the
  flag + token checks pass (jsdom/CI has no MusicKit global).

## 7. Risks and rollback

**Risks**

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Token server down or token expired | Apple features unavailable | App degrades to demo mode automatically (no token → demo); token server returns short-lived tokens; alert on signer failure. |
| `.p8` leak | Token forgery | Key only on signer (P3); portal allows revoking/replacing keys; rotate immediately on suspicion (Apple's documented procedure: create new key first, then revoke old). |
| `authorize()` quirks (forum reports of auth errors despite valid tokens) | M2 stalls | Isolated in M2; capture exact error codes; treat as open question §8; demo mode unaffected. |
| `429` rate limits on catalog calls | Degraded search | Cache responses, back off, fall back to demo catalogue with a message. |
| Behavior divergence between backends | Player UI bugs | Snapshot contract tests in M3; manual matrix in M5; single-backend-at-a-time rule. |
| License/agreement terms for streaming | Legal | M5 review of Apple Developer Program License Agreement MusicKit provisions before public streaming. |
| Silent activation without credentials | Credential-less guarantees broken | Explicit two-key gate (flag **and** token) + CI invariant test (no CDN request by default). |

**Rollback strategy**

1. **Feature rollback (primary, minutes):** unset `VITE_MUSICKIT_ENABLED` /
   token URL in the deployment env → rebuild. Boot logic then always selects
   `DemoBackend` and never loads the MusicKit script; the site is exactly
   today's product.
2. **Code rollback:** M3 is deliberately a no-behavior-change refactor in its
   own commit series, so M4 can be reverted independently without touching the
   extracted `DemoBackend`. Nothing in the queue/session/library persistence
   format changes in any milestone (schema untouched → no data migration, no
   user-data loss on rollback).
3. **Credential compromise:** revoke the key in the Apple portal (P3) and
   rotate; deployed app falls back to demo (it can't sign tokens) while the
   signer is repaired.
4. **Rollback drill** is an M5 acceptance criterion, recorded in
   `replica/build-log.md`.

## 8. Open questions (unresolved — do not treat as blockers)

1. **Domain verification / hosting:** does MusicKit on the Web, or its
   authorization flow, impose any host-domain, TLS-trust, or
   origin-verification requirement beyond the self-asserted `origin` claim?
   Current official docs (§3, verified 2026-10-24) do not state one, but
   portal UI flows and real-world behavior are untested here. **To be settled
   empirically in M1**, including whether the `*.github.io` Pages origin works
   with the `origin` claim. If testing reveals a requirement, this plan gets
   an addendum — until then it is *not* recorded as an established blocker.
2. **Authorization reliability:** public forum threads report `authorize()`
   rejecting with `AUTHORIZATION_ERROR` despite valid developer tokens
   (origin claim, referrer policy, etc. ruled out by reporters). Unknown
   whether this affects new integrations; M2 must test early.
3. **Token lifetime sweet spot:** docs allow `exp` up to 6 months; recommended
   short-lived signer policy (e.g. minutes–hours) is our own choice, to be
   confirmed against cache/refresh behavior in M1.
4. **Subscription-gating granularity:** exact behavior for users with a
   non-subscriber Apple Account (which catalog endpoints work, which error) —
   confirm in M2/M5.
5. **Storefront/region:** default storefront resolution for mixed-region
   users; confirm during M1 harness testing.

## 9. Change log

- 2026-10-24 — Initial approved plan. Domain-verification question checked
  against current official Apple documentation (§3) and demoted to an open
  question (§8); earlier custom-domain assumption retracted pending M1.
- 2026-10-24 — **M1 implemented**: secure runtime token plumbing
  (`src/data/musickit-token.ts`) + conditional, fail-open initialization in
  `src/data/musickit-provider.ts`; gates extended to 89 unit / 11 e2e tests
  (credential-less invariants included). Live `MusicKit.configure()` remains
  unverified — blocked on external P1–P4 prerequisites; §8.1 and §8.3 still
  open pending a real token-signing service.
