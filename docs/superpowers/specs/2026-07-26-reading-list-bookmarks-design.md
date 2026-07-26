# Reading List (Bookmarks) — Design Spec

> **Date:** 2026-07-26  
> **Project:** X-Blog (FastAPI + Nuxt 4)  
> **Approach:** Method A — pure localStorage, no backend changes  
> **Status:** Approved for implementation

## 1. Overview

Add a **bookmark/reading-list** feature that lets visitors save posts to read later.
Storage is entirely client-side via `localStorage`, so no backend migration is
needed. The `/bookmarks` page reads cached post data and renders immediately,
even offline.

## 2. Goals

- Readers can toggle a bookmark with one click from the post list and post detail page.
- Bookmarked posts appear on a dedicated `/bookmarks` page.
- Data persists across page reloads and browser sessions.
- Zero backend changes — no DB migration, no new API endpoints.

## 3. Non-Goals

- Cross-device synchronization (would require user accounts + backend API).
- Real-time sync when a bookmarked post is deleted/edited (acceptable staleness).
- Sharing bookmark lists between users.

## 4. Architecture

### 4.1 Files to Create

| File | Purpose |
|------|---------|
| `frontend/aura/composables/useBookmarks.ts` | Reactive bookmark state + localStorage sync |
| `frontend/aura/components/BookmarkButton.vue` | Reusable bookmark toggle button |
| `frontend/aura/app/pages/bookmarks.vue` | Bookmarks list page |

### 4.2 Files to Modify

| File | Change |
|------|--------|
| `frontend/aura/components/PostCard.vue` | Add bookmark button in card corner |
| `frontend/aura/app/pages/posts/[slug].vue` | Add bookmark button next to like button |
| `frontend/aura/components/Sidebar.vue` | Add "Bookmarks" navigation link |
| `frontend/aura/app/pages/index.vue` | (Optional) Show bookmark count in header |

### 4.3 localStorage Schema

```
Key:   "x_blog_bookmarks"
Type:  Array<Bookmark>

Bookmark {
  id:          number
  title:       string
  slug:        string
  excerpt:     string | null
  cover_image: string | null
  created_at:  string   // ISO date
  category:    { id: number; name: string } | null
  tags:        Array<{ id: number; name: string }>
}
```

**Why store full post summaries?** The `/bookmarks` page can render immediately
without any API request, including the cover image, excerpt, and tags.

## 5. Composable: `useBookmarks`

```typescript
export interface Bookmark {
  id: number
  title: string
  slug: string
  excerpt: string | null
  cover_image: string | null
  created_at: string
  category: { id: number; name: string } | null
  tags: { id: number; name: string }[]
}

export function useBookmarks() {
  const bookmarks = ref<Bookmark[]>([])
  const isClient = computed(() => typeof window !== 'undefined')

  // Load from localStorage on mount (client-only)
  // ...

  const addBookmark = (post: Bookmark) => { ... }
  const removeBookmark = (id: number) => { ... }
  const toggleBookmark = (post: Bookmark) => { ... }
  const isBookmarked = (id: number) => boolean
  const clearBookmarks = () => void
  const bookmarkCount = computed(() => bookmarks.value.length)

  return {
    bookmarks,
    addBookmark,
    removeBookmark,
    toggleBookmark,
    isBookmarked,
    clearBookmarks,
    bookmarkCount,
  }
}
```

**SSR safety:** All `localStorage` access is guarded by `typeof window !== 'undefined'`.
On the server, `bookmarks` initializes to `[]`.

## 6. Component: `BookmarkButton`

```vue
<script setup lang="ts">
interface Props {
  postId: number
  post?: Bookmark    // optional, needed to add a new bookmark
  variant?: 'icon'   // default; 'full' for wider button with label
  size?: 'sm' | 'md' // default 'md'
}
defineEmits<{ (e: 'toggle', id: number): void }>()
</script>
```

- Uses `lucide:bookmark` (outline) when not bookmarked.
- Uses `lucide:bookmark-check` (filled) when bookmarked.
- Adds to `bookmarks` page link: "收藏的文章" (Bookmarks).

## 7. Page: `/bookmarks`

Layout mirrors the homepage:

1. Header: title + count + "Clear All" button.
2. If no bookmarks: empty state with link to `/`.
3. If bookmarks exist: render `PostCard` for each.

Uses `useBookmarks()` for data — no API calls required.

## 8. Data Flow

```
PostCard.vue / posts/[slug].vue
  └─> BookmarkButton.vue
        └─> useBookmarks().toggleBookmark(post)
              │
              ├──> reactive state (Vue ref)
              └──> localStorage.setItem("x_blog_bookmarks", JSON.stringify(...))

/bookmarks.vue (page)
  └─> useBookmarks() → reads localStorage → renders immediately
```

## 9. Error Handling

| Scenario | Handling |
|----------|----------|
| `localStorage` unavailable | Guard with `typeof window !== 'undefined'`; init to `[]` |
| Write fails (quota exceeded) | `try/catch`, log to console, continue gracefully |
| Bookmarked post deleted later | Stale data in `localStorage`; clicking through → 404 page |
| SSR render | `bookmarks` is `[]` on server; client hydrates from storage |

## 10. Testing Plan

### 10.1 Unit Tests (Vitest)

**File:** `tests/composables/useBookmarks.spec.ts`

- ✅ `addBookmark` adds to the list
- ✅ `removeBookmark` removes by ID
- ✅ `toggleBookmark` adds/removes correctly
- ✅ `isBookmarked` returns correct boolean
- ✅ `clearBookmarks` empties the list
- ✅ Persists to `localStorage` and reloads correctly
- ✅ Works in SSR (no crash)

**File:** `tests/components/BookmarkButton.spec.ts`

- ✅ Renders outline icon when not bookmarked
- ✅ Renders filled icon when bookmarked
- ✅ Emits `toggle` event on click
- ✅ Passes `postId` in emit

### 10.2 E2E Tests (Playwright)

**File:** `e2e/bookmarks.spec.ts`

- ✅ Bookmark a post from the post detail page → verify `/bookmarks` shows it
- ✅ Remove a bookmark from `/bookmarks` → verify it disappears
- ✅ Bookmark persists across page reload
- ✅ Empty state appears when no bookmarks exist

## 11. Implementation Order

1. Create `composables/useBookmarks.ts` + unit tests
2. Create `components/BookmarkButton.vue` + unit tests
3. Add bookmark button to `components/PostCard.vue`
4. Add bookmark button to `app/pages/posts/[slug].vue`
5. Add bookmarks link to `components/Sidebar.vue`
6. Create `app/pages/bookmarks.vue` + E2E tests
7. Write all tests → run `just test-frontend`
8. Lint + format check

## 12. Open Questions

- Should we add a "Clear All" confirmation dialog? → Keep it simple, no dialog for v1.
- Should bookmark count appear in a header badge? → Optional, decided during implementation.
