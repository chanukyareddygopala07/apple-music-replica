# Realaxify backend

Optional FastAPI service that aggregates the same free music providers the
frontend already talks to directly (Audius, Jamendo, YouTube) behind one
allow-listed JSON API, plus LRCLIB lyric lookups. The web app works fully
without it — it probes `/api/health` once and falls back to direct provider
calls if the server is absent.

## Run it

```bash
cd backend
uv sync --extra dev           # .venv with runtime + pytest/ruff (Python >= 3.11)
set -a; source .env.example; set +a   # or export just what you need
.venv/bin/uvicorn app.main:app --reload --port 8000
```

No dotenv loader: settings are read from plain process environment variables
(`app/config.py::load_settings`). Defaults are safe — every provider is
enabled but *unconfigured* without its credential, so no upstream request is
made for a source that has no key.

From the repo root, the Vite dev server proxies `/api` to
`http://127.0.0.1:8000` (override with `VITE_API_PROXY`, or point the client
elsewhere entirely with `VITE_API_BASE`).

## Configuration

Copy `.env.example` and see the table there for every variable. Highlights:

| Variable | Default | Meaning |
| --- | --- | --- |
| `AUDIUS_ENABLED` / `AUDIUS_API_KEY` | on / — | Audius discovery provider (anonymous works) |
| `JAMENDO_ENABLED` / `JAMENDO_CLIENT_ID` | on / — | Jamendo CC catalogue; unconfigured = silent |
| `YOUTUBE_ENABLED` / `YOUTUBE_API_KEY` | on / — | YouTube Data API v3 search |
| `LYRICS_ENABLED` / `LRCLIB_BASE_URL` | on / `https://lrclib.net` | LRCLIB lyric lookup (free, no key) |
| `CORS_ORIGINS` | localhost dev/preview origins | Exact allow-list; credentials never allowed |
| `HTTP_TIMEOUT_S`, `CACHE_TTL_S`, `SEARCH_LIMIT`, … | see file | transport, caching, limits |

Server-side credentials are read from the environment only — never returned in
responses, never logged (errors are redacted).

## API surface (prefix `/api`)

| Route | Purpose |
| --- | --- |
| `GET /api/health` | Liveness probe used by the browser client |
| `GET /api/providers` | Per-provider `{supported, enabled, configured, …}` status |
| `GET /api/search?q&language&source&limit` | Grouped search across sources; per-source `ok/empty/error/unconfigured` groups |
| `GET /api/tracks/{provider}/{track_id}` | Single track (404 = authoritative miss) |
| `GET /api/lyrics?track_name&artist_name&album_name&duration` | LRCLIB lookup; 200 `{found:false}` is an ordinary miss |

Domain field names on the wire are camelCase and identical to the frontend's
`Song`/`Album`/`Artist` shapes, so the client maps them 1:1.

Security posture: allow-listed upstream hosts only, redirects disabled, query
length capped, request bodies capped, provider errors sanitized
(`Search failed: …` messages, no stack traces or credentials).

## Tests & lint

```bash
# (`uv sync --extra dev` once — pytest/ruff live in optional-dependencies.dev)
.venv/bin/ruff check .          # lint (config in pyproject.toml)
.venv/bin/python -m pytest      # 83 tests: config, cache, fetcher, providers,
                                # language parity with src/data/languages.ts,
                                # search/tracks/lyrics API behaviour
```

From the repo root, the backend end-to-end suite boots uvicorn + a preview
build: `npm run test:e2e:api` (5 Playwright specs).
