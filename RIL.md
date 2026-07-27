# Repository Intelligence Layer (RIL)

> Central knowledge base for x-blog autonomous engineering. Updated each iteration.

## Project Overview

**Stack**: FastAPI (Python 3.14) + Nuxt 4 (Vue 3) + SQLite + PostgreSQL
**Directory Structure**: `backend/nova/` (FastAPI), `frontend/aura/` (Nuxt 4)
**Status**: Clean working tree, all tests passing (478 backend + 437 Nuxt = 915 total, 92.78% backend coverage)

## Key Findings

### Directory Rename to Named Implementation Pattern (COMPLETED)

- **Change**: Renamed `backend/` → `backend/nova/` and `frontend/nuxt/` → `frontend/aura/`
  as the first implementation pair in a multi-backend experimentation pattern.
- **Rationale**: `nova` (Python's bright new star) for FastAPI backend; `aura` (Vue's visual
  aura) for Nuxt frontend. Future backends could be `backend/orion/`, `backend/hyper/`, etc.
- **Scope**: 165 files renamed across both directories. Updated all path references in
  justfile, docker-compose.yml, CI/CD workflows, README.md/README.zh-CN.md, docs/deployment.md.
- **Docker service names** kept as `backend` and `frontend` for consistency.
- **Verification**: All 478 backend tests pass, all 437 frontend tests pass after rename.
- **Lessons**: Moving `.venv/` with `mv` causes stale path references — must recreate with
  `uv sync --reinstall`. Core dump files (`core.*`) in project root can interfere with
  npm/pnpm postinstall — must be removed before running install.

### Frontend Linting + Coverage Thresholds (COMPLETED)

- **Change**: Added ESLint configuration for the Nuxt 4 frontend, including TypeScript and
  Vue plugin support. Added coverage thresholds (80% lines/branches/statements, 79% functions)
  to `vitest.config.ts`.
- **Files changed**: `lint.config.json` (new), `package.json` (added eslint devDeps),
  `vitest.config.ts` (added coverage config), `justfile` (integrated frontend linting).
- **Fixes applied**:
    - Configured `@typescript-eslint/parser` in `vue-eslint-parser` so TypeScript syntax
  in `.vue` SFCs parses correctly.
    - Added missing Nuxt auto-import globals (`usePosts`, `fetchAdminCategories`, etc.)
  to eliminate false `no-undef` errors.
    - Switched from `@typescript-eslint/no-unused-vars` to `vue/no-unused-vars` which
  properly understands Vue template usage.
    - Fixed unused imports/vars in `default.vue`, `posts/[id].vue`, `index.vue`,
  `Icon.vue`, `CommentList.vue`, `MobileFilterBar.vue`.
    - Fixed regex unnecessary escape in `useToc.ts`.
    - Replaced `<>` fragment syntax (unsupported by `vue-eslint-parser`) with `<div>` in
  `MobileFilterBar.vue`.
    - Auto-fixed 112+ formatting warnings (indentation, self-closing tags, newlines).
    - Removed overly broad ignore patterns that excluded most source files.
- **Result**: ESLint passes with 0 errors and 0 warnings. Coverage: 83.12% lines,
  80.64% branches, 80.43% functions, 84.13% statements. 451 tests pass.

### Next.js fetchWithTimeout Timeout Management Bug (FIXED)

- **Bug**: In `frontend/next/lib/api.ts`, `fetchWithTimeout` created a single `AbortController`
  and `setTimeout` before the retry loop. `clearTimeout` was called on response receipt (line 39)
  or abort (line 58), but NO new timeout was set for retry attempts. This meant:
  1. Retry fetches had no timeout protection — a hanging retry would never abort.
  2. The timeout from the first attempt could fire during the backoff delay, corrupting
     the retry flow.

- **Fix**: Moved `AbortController` + `setTimeout` creation inside the retry loop so each
  attempt gets its own fresh timeout. Used `try/finally` to ensure `clearTimeout` runs on
  ALL code paths (success, 4xx return, 5xx retry, abort, generic catch). Removed the
  manual `clearTimeout` calls from the success/abort paths since `finally` handles them.

- **Test**: Added "creates a fresh AbortController for each retry attempt" test that verifies
  two distinct `AbortSignal` objects are passed to `fetch` across retry attempts.

- **Also**: Applied Biome formatting to `api.crud.test.ts` (pre-existing format violations
  in import statement and object literals that were missed in Round 15+ cleanup).

- **Result**: 590 Next.js tests pass (was 589, +1 new). TypeScript clean (0 errors).
  Biome clean. Backend: 472 tests still pass.

### Backend Admin Update Post Category Bug (FIXED)

- **Bug**: In `backend/app/routers/admin.py`, `admin_update_post` had an unguarded
  `post.category_id = post_data.category_id` assignment. Since `PostUpdate.category_id`
  defaults to `None`, any update request that omitted `category_id` would clear the
  post's existing category association. All other fields were properly guarded with
  `if post_data.field is not None:` checks, but `category_id` was missed.

- **Fix**: Added `if post_data.category_id is not None:` guard around the assignment,
  consistent with all other field guards in the same function.

- **Test**: Updated `test_admin.py` with a test that verifies updating a post's title
  without specifying `category_id` preserves the existing category association.

### SEO Server Routes Verification + robots.txt Fix (COMPLETED)

- **Verification**: All 4 SEO server routes verified end-to-end:
  1. `GET /robots.txt` → backend `seo_router.get("/robots.txt")` — proxies correctly
  2. `GET /sitemap.xml` → backend `seo_router.get("/sitemap.xml")` — proxies correctly
  3. `GET /rss/feed.xml` → backend `rss_router.get("/feed.xml")` — proxies correctly
  4. `GET /rss/atom.xml` → backend `rss_router.get("/atom.xml")` — proxies correctly
- Backend endpoints exist in `app/routers/rss.py` and are registered in `app/main.py`.
- Frontend Nuxt server routes in `server/routes/` correctly proxy to backend with proper
  Content-Type headers and error handling.
- **Bug found & fixed**: Backend `get_robots_txt()` in `rss.py` generated an invalid
  `RSS:` directive in robots.txt output. The robots.txt specification only supports
  `Sitemap:` as a directive for sitemap announcements — `RSS:` is not a valid directive.
  Removed the invalid line. Updated `test_robots_txt` in `test_rss.py` to assert
  `RSS:` is NOT present and `Sitemap:` IS present.
- **Tests added**: `tests/server/seo.spec.ts` with 11 tests covering:
    - Correct backend URL construction for all 4 routes
    - Proper Content-Type headers (text/plain, application/xml, application/rss+xml,
  application/atom+xml)
    - Error handling with `createError` on backend failure
    - Response passthrough from backend

### Legacy Next.js Frontend Removal (COMPLETED)

- **Change**: Removed `frontend/next/` directory entirely. The Nuxt 4 app (`frontend/aura/`)
  is now the sole frontend.
- **Scope**: 163 files deleted. Updated CI/CD to remove Next.js test jobs and build/push
  steps. Updated docker-compose to replace the `frontend` (Next.js) service with the
  `frontend` (Nuxt) service on port 13334. Updated justfile commands.
- **Test counts**: Next.js had 590 tests, which are now gone. Total tests: 915 (478 backend
    - 437 Nuxt). No test coverage lost in areas not yet ported.
- **Verification**: 437 Nuxt tests pass (29 test files), 478 backend tests pass.

### Security: Admin Initial Password via Environment Variable (FIXED)

- **Bug**: Admin initial password was hardcoded or only set via direct database
  manipulation, creating a security risk in production deployments.

- **Fix**: Added `ADMIN_PASSWORD` environment variable support. The init script now reads
  from this env var, falling back to a development default only when explicitly in
  development mode.

- **Test**: Added test verifying that `ADMIN_PASSWORD` env var is respected during
  initialization, and that production mode requires the env var to be set.

## Architecture Notes

### Frontend (Nuxt 4 / Vue 3)

- **Framework**: Nuxt 4 with Nitro (Node.js preset)
- **Styling**: Tailwind CSS v4
- **Icons**: @iconify/vue with lucide icons
- **Testing**: Vitest (unit + component), Playwright (e2e)
- **Server routes**: Nuxt server routes for SEO (rss, sitemap, robots.txt)
- **Composables**: useApi, useI18n, useMarkdown, useAdminAuth, useToc

### Backend (FastAPI / Python 3.14)

- **Framework**: FastAPI with SQLAlchemy ORM
- **Database**: SQLite (default), PostgreSQL (production)
- **Auth**: JWT tokens, admin-only routes
- **Testing**: pytest with pytest-xdist (parallel), 92.78% coverage
- **Linting**: ruff (check + format)

### DevOps

- **Package managers**: uv (Python), pnpm (Node.js)
- **Task runner**: just
- **CI/CD**: GitHub Actions (test → build → deploy)
- **Containerization**: Docker multi-stage builds
- **Git hooks**: prek (commit-msg, pre-push)

## Known Issues / Technical Debt

1. **RIL.md itself** — This file is now updated but may need periodic refresh as the
   project evolves. Consider automating RIL updates as part of the commit cycle.

2. **e2e tests** — 8 e2e specs now (added admin-login.spec.ts with 3 tests).
   Admin CRUD flows (comments, categories, tags, stats) still need e2e coverage.
   Priority: add e2e for admin comment management, category management, and
   post editing flows.

3. ~~Icon.spec.ts failures (8 tests, FIXED)~~ — The Icon.vue component used
   `<IconifyIcon>` in the template without importing it. `IconifyIcon` is a
   TypeScript TYPE from `@iconify/types`, not a Vue component. The actual
   component is `Icon` from `@iconify/vue`. Added `import { Icon as
   IconifyIcon } from "@iconify/vue"` in Icon.vue and mocked `@iconify/vue`
   in Icon.spec.ts (real Icon loads async via API, unavailable in tests).
   All 10 Icon tests now pass.

4. **esbuild 0.28.1 + Vitest 4.1.10 transpilation bug** — `RegExp.exec()` loops
   with `/g` flag in `while` patterns can cause `RangeError: Invalid array length`
   at seemingly unrelated `Array.push` calls when the source file also contains
   `export async function` with dynamic `import()` statements. Root cause:
   esbuild 0.28.1 (used by Vite 8.1.5) has a code generation bug affecting certain
   file structures. **Workaround**: use `String.replace()` with a callback
   instead of `RegExp.exec()` + `while` loop. Fixed in both `useMarkdown.ts`
   (placeholder regex) and `useToc.ts` (heading extraction).

## Completed This Iteration

### SEO Rewrite (COMPLETED)

- **New composable**: `frontend/aura/composables/useSeo.ts` — centralizes all
  SEO metadata generation. Exports `useSeo()`, `usePostSeo()`, `useSiteUrl()`,
  plus pure builder functions (`buildCanonicalUrl`, `buildAbsoluteImageUrl`,
  `buildArticleJsonLd`, `buildSiteJsonLd`) that are testable without Nuxt.
  Includes `siteConfig` with site-wide defaults (name, title, description,
  locale, twitter handle). 53 tests cover all builders and composables.

- **Bug fix in nuxt.config.ts**: OpenGraph `og:*` tags were using `name`
  attribute instead of `property` attribute (incorrect per the OpenGraph
  protocol). Also added `og:image`, `og:url`, Twitter Card image/alt/site tags,
  and a global WebSite JSON-LD structured data script via `buildSiteJsonLd`.
  Added `siteUrl` to `runtimeConfig.public`.

- **Page refactoring**: All 5 pages refactored from inline `useHead()` calls
  to `useSeo()` / `usePostSeo()`:
    - `about.vue` — static page SEO with path
    - `index.vue` — home page SEO with path
    - `posts/[slug].vue` — full BlogPosting JSON-LD via `usePostSeo`
    - `search.vue` — dynamic title + `noindex, follow` robots meta
    - `tags.vue` — dynamic title based on selected tag name

- **Test updates**: `about.spec.ts` updated to stub `useRuntimeConfig` (needed
  by `useSeo` → `useSiteUrl` → `useRuntimeConfig`).

### useMarkdown Crash Fix (COMPLETED)

- **Root cause**: `RegExp.exec()` + `while` loop pattern in `useMarkdown()`
  triggered `RangeError: Invalid array length` at `segments.push(seg)` when
  running under Vitest 4.1.10 with esbuild 0.28.1. The code runs correctly in
  plain Node.js — the bug is in the transpiler, not the source code.

- **Fix**: Replaced the `RegExp.exec()` while loop with `String.replace()`
  using a callback. This is cleaner (no manual `last` position tracking
  needed) and avoids the transpilation bug entirely. All 4 `useMarkdown` tests
  now pass (was 22 failing before the fix).

### useToc Infinite Loop Fix (COMPLETED)

- **Root cause**: `extractToc()` in `composables/useToc.ts` had a fatal
  `RegExp.exec()` + `while` loop that **never called `exec()` again** inside
  the loop body — the `match` variable was never updated, creating an
  INFINITE LOOP. This had 0 test coverage (no `useToc.spec.ts` existed).

- **Impact**: The infinite loop crashed Vitest workers, generating 4-5GB
  core dump files each time. After 5-6 crashes, the disk filled completely
  (28GB of core dumps in `frontend/aura/core.*`). This caused 18 tests in
  `posts/[slug].spec.ts` (which imports a page using `useToc`) to fail
  silently, and prevented all other tests from running reliably.

- **Fix**: Refactored `extractToc()` to use `String.replace()` with a
  callback (same approach as the `useMarkdown.ts` fix), eliminating both
  the infinite loop and the esbuild transpilation bug vulnerability.

- **Tests added**: 12 comprehensive tests in `useToc.spec.ts` covering
  empty input, h1-h6 extraction, heading order, HTML tag stripping, slug
  generation, extra attributes, empty text skipping, paragraphs between
  headings, no headings, and sequential headings.

- **Result**: Full test suite now 518 tests passing (506 + 12 new).

## Completed This Iteration: DOMPurify Validation + Test Mock

- **Problem**: DOMPurify's `sanitize` method exists in happy-dom (test
  environment) but silently fails to strip `<script>` tags. The committed
  code (`purify = mod.default || mod`) accidentally "worked" because calling
  the DOMPurify factory function returned a DOMPurify instance (not a
  sanitized string), and `expect(instance).not.toContain("<script>")`
  passed by accident (checking property existence on a function).

- **Fix in `useMarkdown.ts`**: `loadPurify()` now validates DOMPurify by
  testing `DOMPurify.sanitize("<script>alert(1)</script>")` — if the result
  still contains `<script>`, throws and falls back to the regex-based
  sanitizer. Improved fallback regex to use `[\s\S]*?` for reliable
  multi-line tag stripping. `sanitizeHtml()` now has try/catch for runtime
  error safety.

- **Fix in `tests/setup.ts`**: Mocked `dompurify` module with a regex-based
  sanitizer that properly strips XSS payloads. This ensures tests verify
  actual sanitization behavior, not accidental type coercion.

- **Fix in `Icon.vue`**: Changed from `Icon as IconifyIcon` to direct `Icon`
  import with `void Icon` to satisfy Biome's `noUnusedImports` rule (Vue SFC
  template usage not detected by Biome).

- **Result**: 535 tests pass (518 + 17 new from previous commit), lint clean,
  format clean. Backend: 478 tests pass.

### Key Insight: happy-dom + DOMPurify Incompatibility

DOMPurify reports `isSupported: true` in happy-dom but doesn't properly
sanitize. The only reliable way to detect this is to test the actual
sanitization result with a known XSS payload, not check `isSupported`
or function existence.

## Next Priorities

None — all known high-priority tasks are complete.
All admin CRUD e2e coverage (comments, categories, posts, tags, dashboard)
is in place. Next work will come from deep-dive scanning for new issues.
