# AGENTS.md

Engineering conventions for X-Blog. Complements `CLAUDE.md` (agent skill
metadata) — this file is the working knowledge a landed agent needs to be
productive. Do not duplicate or contradict either.

## Repo layout & run commands

Monorepo with two apps:

- `backend/nova` — FastAPI + SQLAlchemy 2 (Python 3.14, managed via `uv`).
  Source in `app/`; tests in `tests/`; Alembic migrations in `migrations/`.
- `frontend/aura` — Nuxt 4 + Vue (pnpm). App in `app/`, e2e in `e2e/`, unit
  tests in `tests/`, static assets in `public/` (service worker lives at
  `public/sw.js`).

All canonical commands go through `just` (see the root `justfile`):

| Command                           | Meaning / gotchas                                                                                                                                                                                      |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `just install`                    | `cd backend/nova && uv sync`; also installs git hooks                                                                                                                                                  |
| `just backend`                    | uvicorn dev server on :18888 (`APP_ENV=development`)                                                                                                                                                   |
| `just nuxt`                       | Nuxt dev server on :34567 (Windows: run the two in separate terminals)                                                                                                                                 |
| `just init-db`                    | seeds dev DB with sample data (admin/admin123)                                                                                                                                                         |
| `just test-backend`               | `uv run pytest -n auto --cov-fail-under=80` — **enforces the 80% app-coverage gate; the suite fails if coverage drops below it**                                                                       |
| `just test-backend-seq`           | sequential pytest (debug)                                                                                                                                                                              |
| `just test-backend-postgres <N>`  | pytest against a real PostgreSQL (`TEST_DATABASE_URL`); conftest gives each xdist worker its own schema. Workers default to 8, not `-n auto` (auto can exceed the server's `max_connections`)          |
| `just test-nuxt`                  | `pnpm test` (vitest)                                                                                                                                                                                   |
| `just test-nuxt-coverage`         | `pnpm test:coverage`                                                                                                                                                                                   |
| `just lint` / `just fmt-check`    | `ruff check . --fix` / `ruff format --check .`                                                                                                                                                         |
| `just typecheck`                  | `uv run pyright` (config in `backend/nova/pyproject.toml`, runs on `app/` only)                                                                                                                        |
| `just ci`                         | **`ci: fmt-check lint typecheck test`** — the full gate                                                                                                                                                |
| `just e2e`                        | Playwright against a live Nuxt dev server (auto-starts backend + Nuxt via `playwright.config.ts` webServer). Do NOT start a second Nuxt — it poisons the module cache and causes `nuxt.lock` conflicts |
| `just migration` / `just migrate` | `alembic revision --autogenerate` / `alembic upgrade head`                                                                                                                                             |

Gotchas:

- **The coverage gate is enforced** — `--cov-fail-under=80` is in the recipe and
  `fail_under` is configured in `[tool.coverage.report]`; both local run and CI
  enforce the same 80% bar. Never weaken or skip it to make the suite pass.
- pyright, ruff, format, and coverage must **all** pass — they are non-optional
  gates, not suggestions.
- Ruff lint/format config is the single source of truth in `ruff.toml`; the
  `[tool.ruff]` block in `pyproject.toml` is dead config and `[tool.pytest]`
  `addopts = "--cov"` is what makes every local test run measure coverage.

## Git / commit conventions

- **Minimal, complete commits.** Each commit is a self-contained unit of work;
  very small related changes may be combined into one commit. No giant
  interleaved dumps.
- Each commit has a **concise subject** followed by a **bulleted body** that
  lists each distinct change clearly and concisely (what and why per bullet).
- Convention: `type(scope): subject`. Types seen: `fix`, `feat`, `test`,
  `chore`. Examples:
    - `fix(export): type CSV row param covariantly (Sequence) to satisfy pyright`
    - `feat(frontend): offline reading for bookmarked posts via service worker`
- When you do a code change that affects RIL work, **reference the RIL node ids
  in the commit message**, e.g. `fix(core): ... (RIL TASK-001, ISS-006)`.
  Code history and the engineering graph are meant to cross-reference.
- `graph.json` changes are committed as `chore(ril)` commits, e.g.
  `chore(ril): record round-465 closure (EV-327, DEC-506)`.

## RIL / graph-engineering

RIL (Repository Intelligence Layer) is the typed engineering-knowledge graph
that holds project knowledge, open work, and decisions across sessions.

- **Single source of truth:** `.planning/ril/graph.json`.
- **All reads/writes go through `ril.py`** —
  `.agents/skills/graph-engineering/scripts/ril.py`. **Never hand-edit
  `graph.json`** and never maintain a parallel knowledge store. Full schema and
  CLI in `.agents/skills/graph-engineering/SKILL.md` and
  `.agents/skills/graph-engineering/references/ril-schema.md`.
- Node types: `component`, `issue`, `hypothesis`, `evidence`, `decision`,
  `change`, `task`. Edges are typed with explicit semantics
  (`depends_on`, `causes`, `blocks`, `validates`/`refutes`, `resolves`,
  `supersedes`, `addresses`, `located_in`, `part_of`, `implements`, `governs`).
- **Lifecycle statuses:** `active | stale | resolved | superseded | abandoned`.
  Decisions are immutable (history via `supersedes`); evidence is append-only
  (`validates`/`refutes` → hypothesis).
- A **hypothesis with no `validates`/`refutes` evidence is not treated as fact**
  in EVALUATE — unverified root-cause guesses get discounted (it is literally
  part of `priority_score = category_weight × severity × confidence × (1/√effort) × unlock_factor`).
- Canonical commands:

  ```text
  ril.py check                     # orphans / cycles / unproven hypotheses
  ril.py tasks --top 10            # active tasks by priority_score
  ril.py show --id TASK-001 --hops 2
  ril.py node add / node set       # create / optimistically update a node
  ril.py edge add --type addresses --from <task> --to <issue>
  ril.py round                     # advance the loop counter
  ril.py stale --rounds 10         # mark untouched nodes stale
  ```

  `node set` takes `--expect-version` (optimistic locking) — only required when
  multiple instances run in parallel; a single sequential instance skips
  locks/versions (do not invent `status=in_progress`/`owner=` fields — RIL
  schema rejects them).
- The loop is OBSERVE → MODEL → EVALUATE → SELECT → EXECUTE → VERIFY → LEARN →
  REPEAT. When converged (no active task above threshold, gate green), the loop
  writes a `converged-idle` decision and stops — it does NOT keep emitting
  round-dialing `chore(ril)` commits while idle.
- Commit messages reference RIL ids (see Git section above).

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
- **Frontend unit tests:** `just test-nuxt` (`pnpm test`, vitest); run biome
  lint and `nuxt typecheck` as part of the gate.
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
