# Frontend API Client Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 1,900-line Nuxt API client with explicit transport, auth, and domain modules; migrate every caller; then delete the old client without a compatibility facade.

**Architecture:** `api/transport.ts` is the only direct Nuxt transport seam and distinguishes reactive `query()` from imperative `command()`. `api/auth.ts` is the only API-layer token reader. Public, reader, and admin modules own their DTOs and endpoint operations, and callers import those modules directly.

**Tech Stack:** Nuxt 4, Vue 3, TypeScript 6, Vitest 4, Biome 2, Playwright, pnpm 10.

## Global Constraints

- Preserve every backend endpoint, method, payload, and response shape.
- Delete `frontend/aura/composables/useApi.ts`; do not create a compatibility barrel.
- Do not create `api/index.ts` or domain `index.ts` files.
- Reactive setup queries use `useFetch`; event-driven commands use `$fetch`.
- Domain modules must not call `useFetch`, `$fetch`, `useRuntimeConfig`, or localStorage directly.
- Reader/admin token audiences must remain isolated.
- Preserve current login/register ref-based return semantics.
- Do not add retries, caching, global toast handling, token refresh, or an OpenAPI generator.
- Do not create commits unless the user explicitly requests them.
- Each task ends with focused tests, Biome, typecheck, and a code-review gate.

---

## Target File Map

```text
frontend/aura/api/
├── transport.ts
├── auth.ts
├── contracts/shared.ts
├── public/
│   ├── posts.ts
│   ├── taxonomy.ts
│   ├── series.ts
│   ├── comments.ts
│   └── stats.ts
├── reader/
│   ├── auth.ts
│   ├── account.ts
│   ├── bookmarks.ts
│   ├── history.ts
│   ├── follows.ts
│   ├── comments.ts
│   ├── subscriptions.ts
│   └── notifications.ts
└── admin/
    ├── auth.ts
    ├── posts.ts
    ├── taxonomy.ts
    ├── series.ts
    ├── comments.ts
    ├── users.ts
    ├── settings.ts
    ├── calendar.ts
    └── push.ts
```

Tests mirror this structure under `frontend/aura/tests/api/`.

## Required Interfaces

### Transport

```ts
export type ApiQueryPath = Parameters<typeof useFetch>[0];
export type ApiQueryOptions<
	ResT,
	DataT = ResT,
	PickKeys extends KeysOf<DataT> = KeysOf<DataT>,
	DefaultT = undefined,
> = UseFetchOptions<ResT, DataT, PickKeys, DefaultT>;
export type ApiCommandOptions = Parameters<typeof $fetch>[1];
export type QueryValue = string | number | boolean | null | undefined;
export type QueryParams = Record<string, QueryValue>;

// Overloads mirror Nuxt's object-options calls so transform, default, and pick
// determine the AsyncData data type. The string/key overload is excluded.
export function query<
	ResT,
	DataT = ResT,
	PickKeys extends KeysOf<DataT> = KeysOf<DataT>,
	DefaultT = undefined,
>(
	path: ApiQueryPath,
	options?: ApiQueryOptions<ResT, DataT, PickKeys, DefaultT>,
): AsyncData<PickFrom<DataT, PickKeys> | DefaultT, NuxtError<unknown> | undefined>;

export function command<T>(
	path: string,
	options?: ApiCommandOptions,
): Promise<T>;

export function withQuery(path: string, params: QueryParams): string;
```

`ApiQueryOptions` is always an object. It intentionally excludes Nuxt's legacy
string/key overload; transport implementations must never spread an unchecked
string. `query` preserves Nuxt option-driven data inference for `transform`,
`default`, and `pick`.

`withQuery` ignores `undefined`, `null`, and `""`, preserves `false` and `0`,
uses `URLSearchParams`, and does not append `?` for an empty result.

### Auth

```ts
export function readerAuthHeaders(): HeadersInit;
export function adminAuthHeaders(): HeadersInit;
```

Both return `{}` during SSR or with missing/partial localStorage. Reader auth
reads only `reader_token`; admin auth reads only `admin_token`.

### Shared contracts

`api/contracts/shared.ts` exports:

```ts
PaginationInfo;
SeriesBrief;
PostList;
PostListResponse;
Category;
Tag;
Comment;
```

## Export Ownership and Renames

### Public modules

| Module               | Exports                                                                                                                                                                                                                      |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `public/posts.ts`    | `ArchiveEntry`, `Post`, `AdjacentPosts`, `PostFilters`, `PostSearchParams`, `usePosts`, `usePost`, `usePostSearch`, `usePostArchive`, `recordPostView`, `likePost`, `usePopularPosts`, `useRelatedPosts`, `useAdjacentPosts` |
| `public/taxonomy.ts` | `useCategories`, `getCategories`, `useTags`                                                                                                                                                                                  |
| `public/series.ts`   | `SeriesPublic`, `SeriesDetail`, `useSeries`, `useSeriesBySlug`                                                                                                                                                               |
| `public/comments.ts` | `CommentSort`, `CommentFlagResult`, `useComments`, `createComment`, `likeComment`, `flagComment`                                                                                                                             |
| `public/stats.ts`    | `BlogStats`, `useBlogStats`                                                                                                                                                                                                  |

### Reader modules

| Module                    | Exports                                                                                                                                                                                            |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `reader/auth.ts`          | `ReaderLoginResponse`, `readerRegister`, `readerLogin`                                                                                                                                             |
| `reader/account.ts`       | `ReaderProfile`, `useCurrentReader`, `getReaderDataExport`, `updateReaderProfile`, `changeReaderPassword`, `deleteReaderAccount`                                                                   |
| `reader/bookmarks.ts`     | bookmark/folder DTOs, `useReaderBookmarks`, `useReaderBookmarkFolders`, all bookmark/folder commands                                                                                               |
| `reader/history.ts`       | history/progress DTOs, `getReaderHistory`, `recordReaderHistory`, `getReaderReadingPosition`, `getReaderHistoryStats`, `clearReaderHistory`, `useReaderRecommendations`, `useReaderSeriesProgress` |
| `reader/follows.ts`       | follow DTOs, `useReaderFollowsFeed`, `useReaderSeriesFollows`, `useReaderCategoryFollows`, all follow commands                                                                                     |
| `reader/comments.ts`      | my-comment DTOs, `getMyComments`, `deleteMyComment`, `updateMyComment`                                                                                                                             |
| `reader/subscriptions.ts` | subscription DTOs, `usePostSubscription`, `subscribeToPostThread`, `unsubscribeFromPostThread`, `getMyPostSubscriptions`                                                                           |
| `reader/notifications.ts` | inbox/preference/push DTOs, `getReaderNotifications`, mark commands, preference commands, push-device commands                                                                                     |

### Admin modules

| Module              | Exports                                                                                                        |
| ------------------- | -------------------------------------------------------------------------------------------------------------- |
| `admin/auth.ts`     | `adminLogin`                                                                                                   |
| `admin/posts.ts`    | post/revision DTOs, `useAdminPosts`, `useAdminPost`, `usePostRevisions`, create/update/delete/restore commands |
| `admin/taxonomy.ts` | `useAdminCategories`, category commands, `useAdminTags`, tag commands                                          |
| `admin/series.ts`   | series/episode DTOs, `useAdminSeries`, `useAdminSeriesEpisodes`, series/reorder commands                       |
| `admin/comments.ts` | comment DTOs/filters, `getAdminComments`, approve/delete/dismiss commands, plural batch commands               |
| `admin/users.ts`    | user DTOs, `useCurrentAdmin`, `useAdminUsers`, create/delete commands                                          |
| `admin/settings.ts` | `SiteSetting`, `useSiteSetting`, `updateSiteSetting`                                                           |
| `admin/calendar.ts` | calendar DTOs, `getAdminCalendar`                                                                              |
| `admin/push.ts`     | push DTOs, `notifyPushSubscribers`                                                                             |

---

### Task 1: Build Transport, Auth, and Shared Contracts

**Files:**

- Create: `frontend/aura/api/transport.ts`
- Create: `frontend/aura/api/auth.ts`
- Create: `frontend/aura/api/contracts/shared.ts`
- Create: `frontend/aura/tests/api/transport.spec.ts`
- Create: `frontend/aura/tests/api/auth.spec.ts`
- Modify: `frontend/aura/composables/useApi.ts`
- Modify: `frontend/aura/tests/composables/useApi.spec.ts`

**Interfaces:**

- Produces the exact transport and auth interfaces defined above.
- Produces shared DTOs consumed by every later task.
- [ ] **Step 1: Write failing transport tests**

Cover base URL resolution, reactive getter forwarding, option forwarding,
imperative `$fetch`, header/body/method forwarding, and `withQuery` omission and
encoding rules.

```ts
expect(withQuery("/api/x", { zero: 0, off: false, empty: "", none: null }))
	.toBe("/api/x?zero=0&off=false");
```

- [ ] **Step 2: Run transport tests and verify RED**

```bash
cd frontend/aura
pnpm exec vitest run tests/api/transport.spec.ts
```

Expected: module resolution failure for `api/transport.ts`.

- [ ] **Step 3: Write failing auth tests**

Assert browser token reads, SSR fallback, partial localStorage fallback, and
reader/admin audience isolation.

- [ ] **Step 4: Implement transport, auth, and shared contracts**

Only `transport.ts` may call Nuxt transport/config primitives. Only `auth.ts`
may read tokens for API headers.

- [ ] **Step 5: Migrate existing core/auth tests and remove duplicate helpers**

Move `useApi` core assertions and `getAuthHeaders` edge cases out of
`tests/composables/useApi.spec.ts`; import shared DTOs privately in the old file
until all domains migrate.

- [ ] **Step 6: Verify Task 1**

```bash
pnpm exec vitest run tests/api/transport.spec.ts tests/api/auth.spec.ts
pnpm exec biome check api/transport.ts api/auth.ts api/contracts/shared.ts tests/api
pnpm typecheck
```

### Task 2: Migrate Public Posts, Taxonomy, Series, and Stats

**Files:**

- Create: `frontend/aura/api/public/{posts,taxonomy,series,stats}.ts`
- Create: `frontend/aura/tests/api/public/{posts,taxonomy,series,stats}.spec.ts`
- Modify: `frontend/aura/app/pages/{index,categories,tags,search,archive}.vue`
- Modify: `frontend/aura/app/pages/posts/[slug].vue`
- Modify: `frontend/aura/app/pages/posts/[slug]/print.vue`
- Modify: `frontend/aura/app/pages/series/index.vue`
- Modify: `frontend/aura/app/pages/series/[slug].vue`
- Modify: `frontend/aura/components/{HeaderSearch,PostCard}.vue`
- Modify corresponding page/component tests.

**Interfaces:**

- Consumes: `query`, `command`, `withQuery`, shared contracts.
- Produces: all public exports listed in the ownership table except comments.
- [ ] **Step 1: Write failing public-domain tests**

Assert existing URLs plus reactive filter/search getters. Assert post
view/like operations use `command` and return Promises.

- [ ] **Step 2: Verify RED**

```bash
pnpm exec vitest run tests/api/public/posts.spec.ts tests/api/public/taxonomy.spec.ts tests/api/public/series.spec.ts tests/api/public/stats.spec.ts
```

- [ ] **Step 3: Implement the four modules**

Use `withQuery` for posts/search. Preserve current route parameter names and
`useFetch` options.

- [ ] **Step 4: Update production callers and mocks**

Replace raw `useApi(computedUrl)` with domain operations. Rename
`usePostView/usePostLike/fetchCategories` to
`recordPostView/likePost/getCategories`.

- [ ] **Step 5: Remove migrated definitions from the monolith**

Keep only private type imports needed by not-yet-migrated definitions.

- [ ] **Step 6: Verify Task 2**

```bash
pnpm exec vitest run tests/api/public tests/pages/index.spec.ts tests/pages/categories.spec.ts tests/pages/tags.spec.ts tests/pages/search.spec.ts tests/pages/archive.spec.ts tests/pages/posts tests/pages/series
pnpm exec biome check api/public app/pages components tests/api/public
pnpm typecheck
```

### Task 3: Migrate Public Comments

**Files:**

- Create: `frontend/aura/api/public/comments.ts`
- Create: `frontend/aura/tests/api/public/comments.spec.ts`
- Modify: `frontend/aura/components/{CommentForm,CommentList}.vue`
- Modify: `frontend/aura/tests/components/{CommentForm,CommentFormReader,CommentList}.spec.ts`

**Interfaces:**

- Produces `useComments`, `createComment`, `likeComment`, and `flagComment`.
- `createComment`, `likeComment`, and `flagComment` return `Promise<T>`.
- [ ] Write failing endpoint/auth/body tests.
- [ ] Run focused tests and confirm module-not-found RED.
- [ ] Implement `api/public/comments.ts`.
- [ ] Update callers so imperative operations use `await`/try-catch, not AsyncData refs.
- [ ] Remove migrated definitions from `useApi.ts`.
- [ ] Verify:

```bash
pnpm exec vitest run tests/api/public/comments.spec.ts tests/components/CommentForm.spec.ts tests/components/CommentFormReader.spec.ts tests/components/CommentList.spec.ts
pnpm typecheck
```

### Task 4: Migrate Reader Auth and Bookmarks

**Files:**

- Create: `frontend/aura/api/reader/{auth,bookmarks}.ts`
- Create: `frontend/aura/tests/api/reader/{auth,bookmarks}.spec.ts`
- Modify: `frontend/aura/composables/{useReaderAuth,useBookmarkFolders,useBookmarkSync}.ts`
- Modify their tests and bookmark page tests.

**Interfaces:**

- Login/register preserve `{ data, error }`.
- Bookmark queries remain reactive; writes return direct Promises.
- [ ] Write failing reader auth/bookmark tests.
- [ ] Implement both modules using `readerAuthHeaders`.
- [ ] Change dynamic imports to `~~/api/reader/auth` and direct bookmark imports.
- [ ] Replace write-result `.data.value` access with direct Promise values.
- [ ] Remove migrated definitions from `useApi.ts`.
- [ ] Verify:

```bash
pnpm exec vitest run tests/api/reader/auth.spec.ts tests/api/reader/bookmarks.spec.ts tests/composables/useReaderAuth.spec.ts tests/composables/useBookmarkSync.spec.ts tests/pages/bookmarks.spec.ts tests/pages/bookmarks-folders.spec.ts
pnpm typecheck
```

### Task 5: Migrate Reader History and Follows

**Files:**

- Create: `frontend/aura/api/reader/{history,follows}.ts`
- Create: `frontend/aura/tests/api/reader/{history,follows}.spec.ts`
- Modify: `frontend/aura/composables/{useReadingHistory,useResumeReading}.ts`
- Modify reader-aware index/category/series/post/account pages and tests.

**Interfaces:**

- History reads/writes outside setup return direct Promises.
- Series progress and follow lists remain reactive queries.
- Follow commands return direct state DTOs.
- [ ] Write failing history/follow lifecycle tests.
- [ ] Implement both modules with explicit query/command choices.
- [ ] Update callers and remove AsyncData access from command results.
- [ ] Remove migrated definitions from `useApi.ts`.
- [ ] Verify:

```bash
pnpm exec vitest run tests/api/reader/history.spec.ts tests/api/reader/follows.spec.ts tests/composables/useReadingHistory.spec.ts tests/composables/useResumeReading.spec.ts tests/pages/index.spec.ts tests/pages/categories.spec.ts tests/pages/series/progress.spec.ts tests/pages/posts/slug.spec.ts tests/pages/account.spec.ts
pnpm typecheck
```

### Task 6: Finish Reader Domains

**Files:**

- Create: `frontend/aura/api/reader/{account,comments,subscriptions,notifications}.ts`
- Create corresponding API tests.
- Modify account/comments/notifications pages, default layout, CommentList,
  ThreadSubscribeButton, useReaderAuth, and corresponding tests.

**Interfaces:**

- Account, my-comment, inbox, preference, and push-device reads are direct
  Promise getters unless they are used reactively during setup.
- `usePostSubscription` remains reactive.
- [ ] Write failing tests for all four modules.
- [ ] Implement all listed reader exports.
- [ ] Update caller imports, names, mocks, and Promise handling.
- [ ] Remove the final reader definitions from `useApi.ts`.
- [ ] Verify:

```bash
pnpm exec vitest run tests/api/reader tests/pages/account.spec.ts tests/pages/comments.spec.ts tests/pages/notifications.spec.ts tests/layouts/default.spec.ts tests/components/CommentList.spec.ts tests/components/ThreadSubscribeButton.spec.ts
pnpm typecheck
```

### Task 7: Migrate Admin Auth, Users, Taxonomy, Settings, Calendar, and Push

**Files:**

- Create: `frontend/aura/api/admin/{auth,users,taxonomy,settings,calendar,push}.ts`
- Create corresponding API tests.
- Modify admin auth composable and users/categories/tags/settings/calendar/editor/preview pages and tests.

**Interfaces:**

- Admin login preserves refs.
- Setup reads are reactive; calendar and write operations return Promises.
- All operations explicitly use `adminAuthHeaders`.
- [ ] Write failing admin-domain tests.
- [ ] Implement the six modules.
- [ ] Update callers, mocks, and direct Promise handling.
- [ ] Remove migrated definitions from `useApi.ts`.
- [ ] Verify:

```bash
pnpm exec vitest run tests/api/admin/auth.spec.ts tests/api/admin/users.spec.ts tests/api/admin/taxonomy.spec.ts tests/api/admin/settings.spec.ts tests/api/admin/calendar.spec.ts tests/api/admin/push.spec.ts tests/admin/users.spec.ts tests/admin/categories.spec.ts tests/admin/tags.spec.ts tests/pages/admin-settings.spec.ts tests/pages/admin.calendar.spec.ts
pnpm typecheck
```

### Task 8: Migrate Admin Posts and Series

**Files:**

- Create: `frontend/aura/api/admin/{posts,series}.ts`
- Create corresponding API tests.
- Modify admin post list/editor/preview and series pages and tests.

**Interfaces:**

- GET helpers are reactive `use*` functions.
- Create/update/delete/restore/reorder operations return direct DTO Promises.
- [ ] Write failing post/revision/series tests.
- [ ] Implement both modules.
- [ ] Replace command `.data.value`/`.error.value` access with direct values and exceptions.
- [ ] Remove migrated definitions from `useApi.ts`.
- [ ] Verify:

```bash
pnpm exec vitest run tests/api/admin/posts.spec.ts tests/api/admin/series.spec.ts tests/admin/posts.spec.ts tests/admin/posts-id.spec.ts tests/pages/preview-posts-id.spec.ts tests/admin/series.spec.ts
pnpm typecheck
```

### Task 9: Migrate Admin Comments and Delete the Monolith

**Files:**

- Create: `frontend/aura/api/admin/comments.ts`
- Create: `frontend/aura/tests/api/admin/comments.spec.ts`
- Modify admin comments/dashboard pages and tests.
- Delete: `frontend/aura/composables/useApi.ts`
- Delete: `frontend/aura/tests/composables/useApi.spec.ts`

**Interfaces:**

- `getAdminComments` returns a Promise response.
- Batch operation names are plural and return direct Promise results.
- [ ] Write failing admin-comment tests.
- [ ] Implement the module and migrate callers.
- [ ] Move every remaining old test assertion into its owning domain test.
- [ ] Search for old imports and delete both old files only when zero remain.
- [ ] Run focused tests and typecheck.

```bash
pnpm exec vitest run tests/api/admin/comments.spec.ts tests/admin/comments.spec.ts tests/admin/dashboard.spec.ts
pnpm typecheck
```

### Task 10: Completion Audit and Full Regression

**Files:**

- Modify any domain/caller/test file implicated by full-gate failures.
- Update: `docs/superpowers/specs/2026-08-25-frontend-api-client-redesign.md`
  only if implementation revealed a necessary approved design correction.
- [ ] **Prove structural invariants**

```bash
test ! -e frontend/aura/composables/useApi.ts
test ! -e frontend/aura/tests/composables/useApi.spec.ts
! rg -n 'composables/useApi|\buseApi\s*[<(]' frontend/aura --glob '*.{ts,vue}'
! rg -n '\b(useFetch|\$fetch|useRuntimeConfig)\s*[<(]' frontend/aura/api/public frontend/aura/api/reader frontend/aura/api/admin --glob '*.ts'
! rg -n 'localStorage|getItem\(["'\"'](?:reader_token|admin_token)' frontend/aura/api/public frontend/aura/api/reader frontend/aura/api/admin --glob '*.ts'
! rg -n 'api/(?:transport|auth)' frontend/aura/app frontend/aura/components frontend/aura/composables --glob '*.{ts,vue}'
! test -e frontend/aura/api/index.ts
```

- [ ] **Run static and unit gates**

```bash
cd frontend/aura
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

- [ ] **Run critical E2E journeys**

```bash
pnpm exec playwright test \
	e2e/homepage.spec.ts \
	e2e/search.spec.ts \
	e2e/series.spec.ts \
	e2e/reader-auth.spec.ts \
	e2e/history-sync.spec.ts \
	e2e/reader-notifications.spec.ts \
	e2e/admin-comments.spec.ts \
	e2e/admin-series-episodes.spec.ts \
	e2e/admin-calendar.spec.ts
```

If browser/runtime dependencies are unavailable, record the exact command,
failure, and strongest substitute evidence. Do not claim E2E completion.

- [ ] **Run final TypeScript and code-review specialists**

Require zero unresolved CRITICAL/HIGH findings and rerun affected gates after
every fix.

## Completion Evidence

- Old client and old monolithic test file are absent.
- Every former export appears in exactly one domain owner.
- Every production caller imports a domain module.
- Query/command lifecycle is visible in names and return types.
- Reader/admin token handling remains audience-separated.
- Structural searches, Biome, typecheck, Vitest, and build pass.
- Critical E2E flows pass or remain explicitly unverified with documented
  environmental evidence.
