# Frontend API Client Redesign

## Status

Approved design for replacing the monolithic Nuxt API client.

## Problem

`frontend/aura/composables/useApi.ts` combines more than one hundred exports and
roughly 1,900 lines of unrelated responsibilities:

- public, reader, and admin endpoint contracts;
- reactive Nuxt `useFetch` queries;
- imperative `$fetch` commands;
- runtime base URL resolution;
- reader and admin token storage access;
- URL/query-string construction;
- DTO declarations for every domain.

The interface is shallow: callers must know whether each helper is safe during
setup, whether it returns refs or a Promise, whether it runs during SSR, and
which token store it reads. Historical fixes already show the consequence:
imperative actions implemented with `useFetch` silently failed to send requests.

## Goals

- Replace the monolith with domain-oriented modules.
- Make reactive queries and imperative commands distinct interfaces.
- Centralize base URL, query encoding, request headers, and auth token access.
- Keep the backend HTTP contract unchanged.
- Update every caller and test; no compatibility facade is required.
- Leave each domain independently understandable and testable.

## Non-goals

- Changing backend endpoints or payloads.
- Introducing a generated OpenAPI client.
- Adding global error toasts, retries, caching, or token refresh.
- Redesigning page state management.

## Architecture

### Transport seam

`api/transport.ts` is the only module that directly invokes Nuxt transport
primitives.

- `query(path, options)` wraps `useFetch` for reactive GET/setup usage. Its
  options are object-only (the Nuxt string/key overload is rejected), and its
  overloads preserve `transform`, `default`, and `pick` data-type inference.
- `command<T>(path, options)` wraps `$fetch` for event-driven and imperative
  usage.
- `withQuery(path, params)` performs consistent query encoding.

`query` and `command` remain separate rather than accepting a mode flag. Their
different return types and lifecycle requirements are the core interface.

### Authentication adapter

`api/auth.ts` owns SSR-safe localStorage access and exposes:

- `readerAuthHeaders()`
- `adminAuthHeaders()`

Domain modules explicitly select an audience. The transport does not guess
authentication from a URL. Reader and admin tokens remain isolated.

### Domain modules

The client is split by business capability:

```text
api/
├── transport.ts
├── auth.ts
├── contracts/
│   └── shared.ts
├── public/
│   ├── posts.ts
│   ├── taxonomy.ts
│   ├── series.ts
│   ├── comments.ts
│   └── stats.ts
├── admin/
│   ├── auth.ts
│   ├── posts.ts
│   ├── taxonomy.ts
│   ├── series.ts
│   ├── comments.ts
│   ├── users.ts
│   ├── settings.ts
│   ├── calendar.ts
│   └── push.ts
└── reader/
    ├── auth.ts
    ├── account.ts
    ├── bookmarks.ts
    ├── history.ts
    ├── follows.ts
    ├── comments.ts
    ├── subscriptions.ts
    └── notifications.ts
```

Types used by one domain stay beside that domain. Only genuinely shared DTOs
belong in `contracts/shared.ts`.

### Imports and compatibility

The old `composables/useApi.ts` is deleted. Callers import directly from the
domain that owns the operation. No barrel re-exporting every operation is
introduced, because that would recreate the original broad interface.

Breaking import and function-name changes are acceptable. HTTP behavior and
user-visible behavior must remain stable.

## Naming and lifecycle rules

- Reactive setup queries use names beginning with `use`, and return the Nuxt
  `useFetch` result.
- Imperative operations use verbs such as `get`, `create`, `update`, `delete`,
  `mark`, or `record`, and return `Promise<T>`.
- A click handler, watcher callback, timer, or post-mount action must never call
  `query`.
- Domain modules do not access `useRuntimeConfig`, `localStorage`, `useFetch`,
  or `$fetch` directly.

Login and registration may retain reactive query-style return values while
their current form consumers depend on Nuxt refs. Any later conversion to
Promise-based forms is a separate behavior change.

## Data and error flow

1. A caller invokes a domain operation.
2. The domain module builds the path and selects an auth adapter.
3. The domain module invokes `query` or `command`.
4. The transport resolves the configured API base URL, merges headers, and
   delegates to Nuxt.
5. The original Nuxt/$fetch result or exception returns unchanged.

The transport does not swallow, normalize, toast, or retry errors. A domain may
map an error only when the backend exposes a stable domain-specific condition.

## Migration strategy

The refactor proceeds by dependency direction:

1. Add transport, auth, and shared-contract tests.
2. Create domain modules and migrate exported functions in coherent batches.
3. Update production callers and their mocks after each batch.
4. Delete migrated definitions from `useApi.ts`.
5. Delete `useApi.ts` when no imports remain.
6. Prove forbidden direct transport/auth access is absent outside the seams.

Temporary mixed state is allowed during implementation, but each batch must
typecheck and pass its focused tests.

## Testing

### Transport tests

- base URL resolution;
- reactive path/getter forwarding;
- imperative `$fetch` execution;
- method, body, and header merging;
- query parameter encoding and omission rules.

### Authentication tests

- browser token reads;
- SSR without `window`;
- missing or partial localStorage implementations;
- strict reader/admin audience separation.

### Domain tests

Each domain verifies endpoint paths, methods, bodies, query parameters, and
selected auth audience. Tests should assert domain behavior rather than repeat
transport implementation details.

### Regression gates

- Biome lint and formatting;
- Nuxt typecheck;
- complete Vitest suite;
- production Nuxt build;
- relevant Playwright reader/admin journeys when the browser environment is
  available.

Repository searches must show:

- no imports from `composables/useApi`;
- no direct `useFetch` or `$fetch` in domain modules;
- no direct reader/admin token reads outside `api/auth.ts` and the auth state
  composables that persist sessions;
- no duplicate all-domain facade.

## Acceptance criteria

- `composables/useApi.ts` no longer exists.
- Every previous operation has an owning domain module and migrated caller.
- Query versus command lifecycle is explicit in names and return types.
- Reader/admin token handling is centralized and audience-safe.
- All static checks, unit tests, and production build pass.
- Focused E2E flows pass or any unavailable runtime dependency is documented
  with the strongest available substitute evidence.
