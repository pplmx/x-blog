# AGENTS.md

Engineering conventions for X-Blog — the working knowledge a landed agent needs
to be productive. Workflow notes live in `docs/agents/` (`issue-tracker.md`,
`triage-labels.md`, `domain.md`); do not duplicate or contradict them.

## Repo layout & run commands

Monorepo with two apps:

- `backend/nova` — FastAPI + SQLAlchemy 2 (Python 3.14, managed via `uv`).
  Source in `app/`; tests in `tests/`; Alembic migrations in `migrations/`.
- `frontend/aura` — Nuxt 4 + Vue (pnpm). App in `app/`, e2e in `e2e/`, unit
  tests in `tests/`, static assets in `public/` (service worker lives at
  `public/sw.js`).
- `infra` — deployment-side files that nothing discovers by path: the host
  reverse proxy (`caddy/Caddyfile`) and the server half of the deploy workflow
  (`deploy/remote-deploy.sh`). Its `README.md` lists what must stay outside
  (workflows, justfile, compose file, Dockerfiles, per-tool configs) because
  moving those breaks discovery rather than tidying the tree.

All canonical commands go through `just` (see the root `justfile`):

| Command                           | Meaning / gotchas                                                                                                                                                                                                                                                        |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `just install`                    | `cd backend/nova && uv sync`; also installs git hooks                                                                                                                                                                                                                    |
| `just backend`                    | uvicorn dev server on :18888 (`APP_ENV=development`)                                                                                                                                                                                                                     |
| `just nuxt`                       | Nuxt dev server on :34567 (Windows: run the two in separate terminals)                                                                                                                                                                                                   |
| `just init-db`                    | seeds dev DB with sample data (admin/admin123)                                                                                                                                                                                                                           |
| `just test-backend`               | `uv run pytest -n auto --cov-fail-under=80` — **enforces the 80% app-coverage gate; the suite fails if coverage drops below it**                                                                                                                                         |
| `just test-backend-seq`           | sequential pytest (debug)                                                                                                                                                                                                                                                |
| `just test-backend-postgres <N>`  | pytest against a real PostgreSQL (`TEST_DATABASE_URL`); conftest gives each xdist worker its own schema. Workers default to 8, not `-n auto` (auto can exceed the server's `max_connections`)                                                                            |
| `just test-nuxt`                  | `pnpm test` (vitest)                                                                                                                                                                                                                                                     |
| `just test-nuxt-coverage`         | `pnpm test:coverage`                                                                                                                                                                                                                                                     |
| `just lint` / `just fmt-check`    | `ruff check .` (strict, no `--fix`) / `ruff format --check .` — use `just fix` for auto-fix.                                                                                                                                                                             |
| `just typecheck`                  | `ty` (Astral type checker, global `uv tool`; config in `backend/nova/ty.toml`, runs on `app/` only)                                                                                                                                                                      |
| `just ci`                         | **`ci: fmt-check lint typecheck frontend-typecheck audit migrate-check rumdl-check test frontend-build`** — the full local CI mirror (strict lint, backend `ty` + frontend `vue-tsc` type checks, audit, alembic drift check, rumdl, backend+frontend tests, Nuxt build) |
| `just e2e`                        | Playwright against a live Nuxt dev server (auto-starts backend + Nuxt via `playwright.config.ts` webServer). Do NOT start a second Nuxt — it poisons the module cache and causes `nuxt.lock` conflicts                                                                   |
| `just migration` / `just migrate` | `alembic revision --autogenerate` / `alembic upgrade head`                                                                                                                                                                                                               |

Gotchas:

- **The coverage gate is enforced** — `--cov-fail-under=80` is in the recipe;
  `source`/`report`/`exclude_lines` live in `backend/nova/.coveragerc.toml`.
  Both local run and CI enforce the same 80% bar. Never weaken or skip it to
  make the suite pass.
- ty, ruff, format, and coverage must **all** pass — they are non-optional
  gates, not suggestions. `ty`, `ruff`, and `rumdl` are **global `uv tool`
  installs** (set up by `just hooks`), not project dependencies.
- Each tool owns one config file under `backend/nova/`: `pytest.toml` (pytest,
  including `addopts = ["--cov"]`, which is what makes every local test run
  measure coverage), `.coveragerc.toml` (coverage), `ty.toml` (ty), and
  `ruff.toml` (ruff lint/format — the nearest config, so it governs every run
  started inside the backend). `pyproject.toml` holds packaging metadata and
  dependencies only; put new tool settings in the tool's own file.

## Git / commit conventions

- **Minimal, complete commits.** Each commit is a self-contained unit of work;
  very small related changes may be combined into one commit. No giant
  interleaved dumps.
- Each commit has a **concise subject** followed by a **bulleted body** that
  lists each distinct change clearly and concisely (what and why per bullet).
- Convention: `type(scope): subject`. Types seen: `fix`, `feat`, `test`,
  `chore`. Examples:
    - `fix(export): type CSV row param covariantly (Sequence) to satisfy ty`
    - `feat(frontend): offline reading for bookmarked posts via service worker`

## Architecture invariants & gotchas

Hard-won rules — respect them or you'll reintroduce known bugs:

- **ORM objects detach across Sessions.** A SQLAlchemy object belongs to the
  Session that loaded it; once that Session closes the object detaches. Any
  cross-session read/cache must therefore store **serialized dicts, never live
  ORM objects** (see `posts.py` `list_posts`: it does `model_dump(mode="json")`
  into `posts_list_cache` precisely so no ORM object survives the per-request
  Session).
- **SQLite dev DB runs with FK pragma enabled in tests** (`PRAGMA foreign_keys=ON`
  in `tests/conftest.py`) so FK behaviour matches PostgreSQL semantics. Keep
  tests that rely on FK enforcement under this pragma; the real deployment
  dialect is PostgreSQL and CI/dialect parity is checked via
  `just test-backend-postgres`.
- **Multi-worker deployments make in-process caches / rate-limit buckets
  per-process.** `posts_list_cache` and the rate limiter are in-process, so
  behind multiple workers you get stale posts across workers and rate limits
  effectively multiplied per IP. This is a **known, documented, deferred
  trade-off** — don't silently "fix" it by bolting on a distributed store
  without a decision; read the relevant `supersedes` decision chain first.
- **`X-Forwarded-For` trust must be configured per deployment.** The rate
  limiter's `get_remote_address` reads the leftmost XFF entry (per RFC 7239)
  only when a trusted proxy is present; it falls back to the peer when there is
  no such header. Trusting XFF is a deployment concern — don't assume it.
- **Service-worker cache-name sync (offline features).** The cache name lives
  in `public/sw.js` (`BOOKMARKS_CACHE_NAME = "xblog-bookmarks-v1"`) AND in
  `frontend/aura/composables/useOfflineBookmarks.ts`
  (`OFFLINE_BOOKMARKS_CACHE`). **Keep the two in sync** — the page JS opens the
  exact cache the SW writes.
- **Empty paginated sets return `total_pages = 0`** (`(total + limit - 1) // limit`
  with total 0 → 0). This is accepted convention; the frontend guards against
  it. Don't change it to 1.

## Testing expectations

- **Backend:** `pytest -n auto` enforces an **80% app-coverage gate** on the
  full suite (`source = ["app"]`). Dialect parity verified by running the suite
  against PostgreSQL. Never delete or weaken tests to make the suite pass.
- **Frontend unit tests:** `just test-nuxt` (`pnpm test` → `vp test`, Vitest 5 bundled
  with Vite+); run `pnpm lint` (`vp lint`, Oxlint) and `nuxt typecheck` as part of the
  gate. The frontend toolchain is **Vite+** (`vite-plus`, the unified `vp` CLI) as the
  outer command: `vp` manages the package manager (`vp install`) and owns
  `test`/`lint`/`check`/`fmt`. Nuxt-owned commands (`build`, `dev`, `generate`,
  `preview`, `typecheck`, `prepare`) are exposed as leaf scripts (`nuxt:*`) and reached
  through `vp run` (`pnpm build` → `vp run nuxt:build` → `nuxt build`); the Nitro/SSR
  build stays Nuxt's. Config lives in one standalone `vite.config.ts` (Nuxt's build stays
  in `nuxt.config.ts`). Oxlint lints `.vue` `<script>` only — it does **not** lint Vue
  templates (accepted tradeoff of the Biome→Oxlint switch). Dev/build/test scripts live
  in `package.json`; CI runs `pnpm lint`, `pnpm typecheck`, `pnpm build`,
  `pnpm test --coverage`.
- **TypeScript stays on 6.x until Vue Language Tools v4.** `vue-tsc` resolves
  `typescript/lib/tsc` and patches the compiler's internals; TypeScript 7 ships
  only a launcher for the native (Go) compiler plus `./unstable/*` APIs, so
  `pnpm typecheck` dies with `ERR_PACKAGE_PATH_NOT_EXPORTED`. Support is landing
  in language-tools v4 (`@vue/content-mapper`, which hands `.vue` files to
  TS 7's own `tsc`). Keep the exact `6.0.3` pin — `pnpm up --latest` will
  otherwise move it to 7 and break the typecheck gate.
- **Service-worker behaviour** is tested by loading `public/sw.js` in a **fake
  `self` scope** inside vitest (`frontend/aura/tests/sw.spec.ts`), exercising
  its pure helpers with a stubbed CacheStorage. When you change `sw.js`, extend
  the sw.spec harness — don't test the SW through the browser.
- **E2E:** Playwright (`just e2e`) against a live Nuxt dev server started by
  Playwright's own webServer; do not start a second one.
- Never delete tests, weaken assertions, lower thresholds, comment out failing
  cases, or adjust quality bars to manufacture a passing suite. If something
  only passes after such a change, find and fix the real root cause (or mark
  the associated hypothesis refuted with evidence).

## Recent feature work pointer (preferred delivery pattern)

The **installable PWA + offline reading of saved posts** vertical slice was
delivered end-to-end as the reference pattern for how user-visible features
land here:

- Web app manifest + generated 192/512 icons + `theme-color` wired into the app
  head (`manifest.webmanifest`, `nuxt.config.ts`) for "Add to Home Screen".
- A **bounded offline cache** in `public/sw.js` (network-first with offline
  fallback; the bookmarks cache is proactively populated from the saved set),
  gated by `isCacheablePath` (excludes `/api`, `/admin`, `/rss`, `/feed.xml`,
  `/sitemap.xml`) and a `message` API (`offline-precache` / `offline-unbookmark`).
- `useOfflineBookmarks` composable bridging `/bookmarks` to the SW cache
  (precache/prune + a per-row **"available offline" badge** from real cache
  state).
- Tested at every level: 5 new `sw.spec.ts` unit cases (fake-`self` harness) +
  2 new Playwright e2e specs.

Pattern to imitate: **one cohesive vertical slice** — backend + frontend +
unit/e2e tests + docs landed together so it is testable end-to-end, even when
that pushes a single commit past the usual 300-line diff budget (the offline
commit documents exactly why).
