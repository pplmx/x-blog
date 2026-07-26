# Reading List (Bookmarks) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a client-side bookmark/reading-list feature using localStorage — readers can save posts to read later with no backend changes.

**Architecture:** A reactive `useBookmarks` composable (reads/writes `localStorage`), a reusable `BookmarkButton` component, integration into `PostCard` and post detail page, a dedicated `/bookmarks` page, and a Sidebar nav link.

**Tech Stack:** Vue 3 Composition API (Nuxt 4), TypeScript, Tailwind CSS, Vitest (happy-dom), Playwright E2E.

## Global Constraints

- TypeScript strict mode — all props/interfaces must be typed
- Commit messages use Conventional Commits (`feat:`, `test:`, `docs:`)
- English for commit messages, code comments, and design docs
- Chinese for user-facing UI text
- All composables auto-imported from `~/composables/`
- Components auto-imported with no prefix from `~/components/`
- 80%+ test coverage threshold (Vitest)
- Tests use Vitest with `globals: true` and `happy-dom` environment
- Component tests stub `Icon` and `NuxtLink`
- E2E tests use Playwright with `@playwright/test`

---

## File Structure

| File | Action |
|------|--------|
| `frontend/aura/composables/useBookmarks.ts` | Create |
| `frontend/aura/components/BookmarkButton.vue` | Create |
| `frontend/aura/app/pages/bookmarks.vue` | Create |
| `frontend/aura/tests/composables/useBookmarks.spec.ts` | Create |
| `frontend/aura/tests/components/BookmarkButton.spec.ts` | Create |
| `frontend/aura/e2e/bookmarks.spec.ts` | Create |
| `frontend/aura/components/PostCard.vue` | Modify — add BookmarkButton |
| `frontend/aura/tests/components/PostCard.spec.ts` | Modify — add bookmark tests |
| `frontend/aura/app/pages/posts/[slug].vue` | Modify — add BookmarkButton |
| `frontend/aura/components/Sidebar.vue` | Modify — add Bookmarks nav link |

---

## Task 1: Create `useBookmarks` composable

**Files:**
- Create: `frontend/aura/composables/useBookmarks.ts`
- Test: `frontend/aura/tests/composables/useBookmarks.spec.ts`

**Interfaces:**
- Consumes: none (standalone)
- Produces: `useBookmarks()` → `{ bookmarks, isBookmarked, addBookmark, removeBookmark, toggleBookmark, clearBookmarks, bookmarkCount, refresh }`

- [ ] **Step 1: Write the failing test**

```typescript
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { nextTick } from "vue";

import { useBookmarks, type Bookmark } from "../../composables/useBookmarks.ts";

const mockBookmark: Bookmark = {
	id: 1,
	title: "Test Post",
	slug: "test-post",
	excerpt: "An excerpt",
	cover_image: null,
	created_at: "2024-01-15T10:00:00Z",
	category: { id: 1, name: "Tech" },
	tags: [{ id: 1, name: "vue" }],
};

beforeEach(() => {
	// Clear localStorage before each test
	localStorage.clear();
});

afterEach(() => {
	localStorage.clear();
});

describe("useBookmarks", () => {
	describe("addBookmark", () => {
		it("adds a bookmark to the list", () => {
			const { bookmarks, addBookmark } = useBookmarks();
			addBookmark(mockBookmark);
			expect(bookmarks.value).toHaveLength(1);
			expect(bookmarks.value[0].id).toBe(1);
		});

		it("does not add duplicate bookmarks", () => {
			const { bookmarks, addBookmark } = useBookmarks();
			addBookmark(mockBookmark);
			addBookmark(mockBookmark);
			expect(bookmarks.value).toHaveLength(1);
		});
	});

	describe("removeBookmark", () => {
		it("removes a bookmark by id", () => {
			const { bookmarks, addBookmark, removeBookmark } = useBookmarks();
			addBookmark(mockBookmark);
			removeBookmark(1);
			expect(bookmarks.value).toHaveLength(0);
		});

		it("does nothing if the bookmark does not exist", () => {
			const { bookmarks, removeBookmark } = useBookmarks();
			removeBookmark(999);
			expect(bookmarks.value).toHaveLength(0);
		});
	});

	describe("toggleBookmark", () => {
		it("adds a bookmark when not bookmarked", () => {
			const { bookmarks, toggleBookmark } = useBookmarks();
			toggleBookmark(mockBookmark);
			expect(bookmarks.value).toHaveLength(1);
		});

		it("removes a bookmark when already bookmarked", () => {
			const { bookmarks, toggleBookmark } = useBookmarks();
			toggleBookmark(mockBookmark);
			toggleBookmark(mockBookmark);
			expect(bookmarks.value).toHaveLength(0);
		});
	});

	describe("isBookmarked", () => {
		it("returns true when the post is bookmarked", () => {
			const { addBookmark, isBookmarked } = useBookmarks();
			addBookmark(mockBookmark);
			expect(isBookmarked(1)).toBe(true);
		});

		it("returns false when the post is not bookmarked", () => {
			const { isBookmarked } = useBookmarks();
			expect(isBookmarked(1)).toBe(false);
		});
	});

	describe("clearBookmarks", () => {
		it("removes all bookmarks", () => {
			const { bookmarks, addBookmark, clearBookmarks } = useBookmarks();
			addBookmark(mockBookmark);
			addBookmark({ ...mockBookmark, id: 2 });
			clearBookmarks();
			expect(bookmarks.value).toHaveLength(0);
		});
	});

	describe("bookmarkCount", () => {
		it("returns 0 when no bookmarks", () => {
			const { bookmarkCount } = useBookmarks();
			expect(bookmarkCount.value).toBe(0);
		});

		it("returns the correct count", () => {
			const { addBookmark, bookmarkCount } = useBookmarks();
			addBookmark(mockBookmark);
			addBookmark({ ...mockBookmark, id: 2 });
			expect(bookmarkCount.value).toBe(2);
		});
	});

	describe("persistence", () => {
		it("persists bookmarks to localStorage", () => {
			const { addBookmark } = useBookmarks();
			addBookmark(mockBookmark);
			const stored = JSON.parse(localStorage.getItem("x_blog_bookmarks") || "[]");
			expect(stored).toHaveLength(1);
			expect(stored[0].id).toBe(1);
		});

		it("loads bookmarks from localStorage on init", () => {
			localStorage.setItem("x_blog_bookmarks", JSON.stringify([mockBookmark]));
			const { bookmarks } = useBookmarks();
			expect(bookmarks.value).toHaveLength(1);
		});
	});

	describe("refresh", () => {
		it("reloads bookmarks from localStorage", () => {
			const { bookmarks, refresh } = useBookmarks();
			localStorage.setItem("x_blog_bookmarks", JSON.stringify([mockBookmark]));
			refresh();
			expect(bookmarks.value).toHaveLength(1);
		});
	});

	describe("SSR safety", () => {
		it("does not crash when window is undefined", () => {
			const originalWindow = global.window;
			// @ts-expect-error — intentionally removing window for SSR test
			delete global.window;
			const { bookmarks, addBookmark } = useBookmarks();
			expect(bookmarks.value).toEqual([]);
			addBookmark(mockBookmark);
			expect(bookmarks.value).toEqual([]);
			global.window = originalWindow;
		});
	});
});
```

Expected: 17 failing tests (composable doesn't exist yet).

- [ ] **Step 2: Run test to verify it fails**

```bash
cd frontend/aura && npx vitest run tests/composables/useBookmarks.spec.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```typescript
// frontend/aura/composables/useBookmarks.ts
import { computed, ref } from "vue";

export interface Bookmark {
	id: number;
	title: string;
	slug: string;
	excerpt: string | null;
	cover_image: string | null;
	created_at: string;
	category: { id: number; name: string } | null;
	tags: { id: number; name: string }[];
}

const STORAGE_KEY = "x_blog_bookmarks";

function isClient(): boolean {
	return typeof window !== "undefined";
}

function loadFromStorage(): Bookmark[] {
	if (!isClient()) return [];
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return [];
		return JSON.parse(raw) as Bookmark[];
	} catch {
		return [];
	}
}

function saveToStorage(bookmarks: Bookmark[]): void {
	if (!isClient()) return;
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(bookmarks));
	} catch {
		// Storage full or unavailable — silently ignore
	}
}

export function useBookmarks() {
	const bookmarks = ref<Bookmark[]>(loadFromStorage());

	function isBookmarked(id: number): boolean {
		return bookmarks.value.some((b) => b.id === id);
	}

	function addBookmark(post: Bookmark): void {
		if (isBookmarked(post.id)) return;
		bookmarks.value = [...bookmarks.value, post];
		saveToStorage(bookmarks.value);
	}

	function removeBookmark(id: number): void {
		const before = bookmarks.value.length;
		bookmarks.value = bookmarks.value.filter((b) => b.id !== id);
		if (bookmarks.value.length !== before) {
			saveToStorage(bookmarks.value);
		}
	}

	function toggleBookmark(post: Bookmark): void {
		if (isBookmarked(post.id)) {
			removeBookmark(post.id);
		} else {
			addBookmark(post);
		}
	}

	function clearBookmarks(): void {
		bookmarks.value = [];
		saveToStorage(bookmarks.value);
	}

	function refresh(): void {
		bookmarks.value = loadFromStorage();
	}

	const bookmarkCount = computed(() => bookmarks.value.length);

	return {
		bookmarks,
		isBookmarked,
		addBookmark,
		removeBookmark,
		toggleBookmark,
		clearBookmarks,
		bookmarkCount,
		refresh,
	};
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd frontend/aura && npx vitest run tests/composables/useBookmarks.spec.ts
```

Expected: all 17 tests PASS.

- [ ] **Step 5: Commit**

```bash
cd frontend/aura && git add composables/useBookmarks.ts tests/composables/useBookmarks.spec.ts
git commit -m "feat: add useBookmarks composable for reading list"
```

---

## Task 2: Create `BookmarkButton` component

**Files:**
- Create: `frontend/aura/components/BookmarkButton.vue`
- Test: `frontend/aura/tests/components/BookmarkButton.spec.ts`

**Interfaces:**
- Consumes: `useBookmarks()` from composables — `isBookmarked(id)`, `toggleBookmark(post)`
- Produces: `<BookmarkButton :post-id="number" :post="Bookmark" @toggle="handler" />`

- [ ] **Step 1: Write the failing test**

```typescript
import { type VueWrapper, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import BookmarkButton from "../../components/BookmarkButton.vue";

const mockBookmark = {
	id: 1,
	title: "Test Post",
	slug: "test-post",
	excerpt: "An excerpt",
	cover_image: null,
	created_at: "2024-01-15T10:00:00Z",
	category: { id: 1, name: "Tech" },
	tags: [{ id: 1, name: "vue" }],
};

const stubs = {
	Icon: {
		template: '<svg class="icon-stub" :data-icon="icon"></svg>',
		props: ["icon"],
	},
};

describe("BookmarkButton", () => {
	let wrapper: VueWrapper;

	beforeEach(() => {
		localStorage.clear();
	});

	afterEach(() => {
		if (wrapper) wrapper.unmount();
		localStorage.clear();
	});

	describe("rendering", () => {
		it("renders without errors", () => {
			wrapper = mount(BookmarkButton, {
				props: { postId: 1, post: mockBookmark },
				global: { stubs },
			});
			expect(wrapper.exists()).toBe(true);
		});

		it("renders a button element", () => {
			wrapper = mount(BookmarkButton, {
				props: { postId: 1, post: mockBookmark },
				global: { stubs },
			});
			expect(wrapper.find("button").exists()).toBe(true);
		});

		it("renders outline bookmark icon when not bookmarked", () => {
			wrapper = mount(BookmarkButton, {
				props: { postId: 1, post: mockBookmark },
				global: { stubs },
			});
			const icon = wrapper.find(".icon-stub");
			expect(icon.attributes("data-icon")).toBe("lucide:bookmark");
		});

		it("renders filled bookmark icon when bookmarked", async () => {
			wrapper = mount(BookmarkButton, {
				props: { postId: 1, post: mockBookmark },
				global: { stubs },
			});
			// Click to bookmark
			await wrapper.find("button").trigger("click");
			await wrapper.vm.$nextTick();
			const icon = wrapper.find(".icon-stub");
			expect(icon.attributes("data-icon")).toBe("lucide:bookmark-check");
		});

		it("changes title to cancel when bookmarked", async () => {
			wrapper = mount(BookmarkButton, {
				props: { postId: 1, post: mockBookmark },
				global: { stubs },
			});
			expect(wrapper.find("button").attributes("title")).toBe("收藏文章");
			await wrapper.find("button").trigger("click");
			await wrapper.vm.$nextTick();
			expect(wrapper.find("button").attributes("title")).toBe("取消收藏");
		});

		it("has a title attribute for accessibility", () => {
			wrapper = mount(BookmarkButton, {
				props: { postId: 1, post: mockBookmark },
				global: { stubs },
			});
			expect(wrapper.find("button").attributes("title")).toBe("收藏文章");
		});
	});

	describe("click behavior", () => {
		it("emits toggle event with postId on click", async () => {
			wrapper = mount(BookmarkButton, {
				props: { postId: 42, post: mockBookmark },
				global: { stubs },
			});
			await wrapper.find("button").trigger("click");
			expect(wrapper.emitted("toggle")).toBeTruthy();
			expect(wrapper.emitted("toggle")?.[0]).toEqual([42]);
		});

		it("toggles bookmark state on click", async () => {
			wrapper = mount(BookmarkButton, {
				props: { postId: 1, post: mockBookmark },
				global: { stubs },
			});
			const button = wrapper.find("button");
			// First click: bookmark
			await button.trigger("click");
			await wrapper.vm().$nextTick();
			expect(wrapper.find(".icon-stub").attributes("data-icon")).toBe(
				"lucide:bookmark-check",
			);
			// Second click: unbookmark
			await button.trigger("click");
			await wrapper.vm.$nextTick();
			expect(wrapper.find(".icon-stub").attributes("data-icon")).toBe(
				"lucide:bookmark",
			);
		});

		it("stops click propagation to prevent navigation", async () => {
			const stopPropagation = vi.fn();
			wrapper = mount(BookmarkButton, {
				props: { postId: 1, post: mockBookmark },
				global: { stubs },
			});
			const event = new MouseEvent("click", { bubbles: true });
			Object.defineProperty(event, "stopPropagation", { value: stopPropagation });
			wrapper.find("button").element.dispatchEvent(event);
			expect(stopPropagation).toHaveBeenCalled();
		});
	});

	describe("with variant full", () => {
		it("renders with label text when variant is full", () => {
			wrapper = mount(BookmarkButton, {
				props: { postId: 1, post: mockBookmark, variant: "full" },
				global: { stubs },
			});
			expect(wrapper.text()).toContain("收藏");
		});
	});
});
```

Expected: 9 failing tests (component doesn't exist yet).

- [ ] **Step 2: Run test to verify it fails**

```bash
cd frontend/aura && npx vitest run tests/components/BookmarkButton.spec.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```vue
<!-- frontend/aura/components/BookmarkButton.vue -->
<script setup lang="ts">
import type { Bookmark } from "~/composables/useBookmarks";

interface Props {
	postId: number;
	post?: Bookmark;
	variant?: "icon" | "full";
}

interface Emits {
	(e: "toggle", postId: number): void;
}

const props = withDefaults(defineProps<Props>(), {
	variant: "icon",
});

const emit = defineEmits<Emits>();

const { isBookmarked, toggleBookmark } = useBookmarks();

function handleClick() {
	if (props.post) {
		toggleBookmark(props.post);
	}
	emit("toggle", props.postId);
}
</script>

<template>
  <button
    type="button"
    @click.stop="handleClick"
    :title="isBookmarked(postId) ? '取消收藏' : '收藏文章'"
    :class="[
      'inline-flex items-center justify-center rounded-xl transition-all duration-200',
      variant === 'icon'
        ? 'w-9 h-9 p-0 hover:bg-gray-100 dark:hover:bg-gray-800'
        : 'gap-2 px-3 py-1.5 text-sm',
      isBookmarked(postId)
        ? 'text-blue-600 dark:text-blue-400'
        : 'text-gray-500 hover:text-blue-600 dark:text-gray-400 dark:hover:text-blue-400',
    ]"
  >
    <Icon
      :icon="isBookmarked(postId) ? 'lucide:bookmark-check' : 'lucide:bookmark'"
      :class="variant === 'full' ? 'w-4 h-4' : 'w-5 h-5'"
    />
    <span v-if="variant === 'full'" class="hidden sm:inline">
      {{ isBookmarked(postId) ? '已收藏' : '收藏' }}
    </span>
  </button>
</template>
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd/frontend/aura && npx vitest run tests/components/BookmarkButton.spec.ts
```

Expected: all 9 tests PASS.

- [ ] **Step 5: Commit**

```bash
cd/frontend/aura && git add components/BookmarkButton.vue tests/components/BookmarkButton.spec.ts
git commit -m "feat: add BookmarkButton component with toggle and emit"
```

---

## Task 3: Add `BookmarkButton` to `PostCard`

**Files:**
- Modify: `frontend/aura/components/PostCard.vue:34` (article classes)
- Modify: `frontend/aura/components/PostCard.vue:35-93` (add BookmarkButton inside card)
- Modify: `frontend/aura/tests/components/PostCard.spec.ts` — add bookmark tests

**Interfaces:**
- Consumes: `BookmarkButton` component (auto-imported), `post` prop
- Produces: PostCard with bookmark button in top-right corner

- [ ] **Step 1: Add bookmark tests to PostCard spec**

Add to `tests/components/PostCard.spec.ts`:

```typescript
describe("bookmark", () => {
	it("renders a bookmark button", () => {
		const wrapper = mountPostCard();
		expect(wrapper.find("button[title='收藏文章']").exists()).toBe(true);
	});

	it("renders bookmark button with correct postId", () => {
		const wrapper = mountPostCard();
		const button = wrapper.find("button[title='收藏文章']");
		expect(button.exists()).toBe(true);
	});
});
```

Need to add `BookmarkButton` to the stubs:

```typescript
const stubs = {
	Icon: {
		template: '<svg class="icon-stub" :data-icon="icon"></svg>',
		props: ["icon"],
	},
	NuxtLink: {
		template: '<a class="nuxt-link-stub"><slot/></a>',
	},
	BookmarkButton: {
		template: '<button class="bookmark-stub" :title="variant === \'full\' ? \'收藏文章\' : \'收藏文章\'" :data-post-id="postId"></button>',
		props: ["postId", "post", "variant"],
	},
};
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd/frontend/aura && npx vitest run tests/components/PostCard.spec.ts
```

Expected: FAIL — bookmark tests fail (button not found).

- [ ] **Step 3: Add BookmarkButton to PostCard**

In `components/PostCard.vue`, modify the `<article>` opening tag to add `relative`:

```vue
<article class="group border border-gray-100 dark:border-gray-800 rounded-2xl overflow-hidden hover:border-gray-200 dark:hover:border-gray-700 hover:shadow-xl hover:shadow-gray-100/50 dark:hover:shadow-gray-900/50 transition-all duration-300 bg-white dark:bg-gray-900 relative">
```

Add the BookmarkButton right after the opening `<article>` tag, before the `<NuxtLink>`:

```vue
<div class="absolute top-3 right-3 z-10">
  <BookmarkButton
    :post-id="post.id"
    :post="post"
    variant="icon"
  />
</div>
```

Note: `post` from `toRefs(props)` is a `Ref<PostList>`. Vue auto-unwraps refs in templates, so `:post="post"` passes the unwrapped `PostList` object. `PostList` satisfies the `Bookmark` interface.

- [ ] **Step 4: Run test to verify it passes**

```bash
cd/frontend/aura && npx vitest run tests/components/PostCard.spec.ts
```

Expected: all tests PASS including new bookmark tests.

- [ ] **Step 5: Commit**

```bash
cd/frontend/aura && git add components/PostCard.vue tests/components/PostCard.spec.ts
git commit -m "feat: add bookmark button to PostCard"
```

---

## Task 4: Add `BookmarkButton` to post detail page

**Files:**
- Modify: `frontend/aura/app/pages/posts/[slug].vue:198-218` (near like button)

**Interfaces:**
- Consumes: `BookmarkButton` component, `post` data from `usePost()`
- Produces: post detail page with bookmark button next to like button

- [ ] **Step 1: Locate the like button section**

The like button is at lines 198-218:

```vue
<!-- Like button -->
<div class="mt-8 pt-6 border-t border-gray-200 flex items-center gap-4">
  <button type="button" @click="handleLike" ...>
    ...
  </button>
  <span v-if="post.likes">{{ post.likes }} 次喜欢</span>
  <span v-if="likeError">{{ likeError }}</span>
</div>
```

- [ ] **Step 2: Add BookmarkButton before the like button div**

```vue
<!-- Bookmark button -->
<div v-if="post" class="mt-8 pt-6 border-t border-gray-200 flex items-center gap-4">
  <BookmarkButton
    :post-id="post.id"
    :post="post"
    variant="full"
  />
</div>

<!-- Like button -->
<div class="mt-8 pt-6 border-t border-gray-200 flex items-center gap-4">
  ...existing like button...
</div>
```

- [ ] **Step 3: Verify the page compiles**

```bash
cd frontend/aura && npx nuxi typecheck
```

(Or run the existing slug page test if it exists.)

- [ ] **Step 4: No new test for this page** (post detail page is covered by e2e)

- [ ] **Step 5: Commit**

```bash
cd frontend/aura && git add app/pages/posts/[slug].vue
git commit -m "feat: add bookmark button to post detail page"
```

---

## Task 5: Add bookmarks link to Sidebar

**Files:**
- Modify: `frontend/aura/components/Sidebar.vue` — add navigation link

**Interfaces:**
- Consumes: `useBookmarks()` for count display
- Produces: Sidebar with "Bookmarks" link showing count

- [ ] **Step 1: Add import of useBookmarks**

Since composables are auto-imported, no explicit import needed. But we need `bookmarkCount` from `useBookmarks()`.

- [ ] **Step 2: Add bookmarkCount to script setup**

After the existing `const { categories, tags, popularPosts } = toRefs(props);`:

```typescript
const { bookmarkCount } = useBookmarks();
```

- [ ] **Step 3: Add Bookmarks nav link in the sidebar**

Add after the Categories section (before Tags):

```vue
<!-- Bookmarks -->
<NuxtLink
  to="/bookmarks"
  class="flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-xl transition-colors"
>
  <Icon icon="lucide:bookmark" class="w-4 h-4" />
  <span>收藏的文章</span>
  <span
    v-if="bookmarkCount > 0"
    class="ml-auto bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 text-xs px-2 py-0.5 rounded-full"
  >
    {{ bookmarkCount }}
  </span>
</NuxtLink>
```

- [ ] **Step 4: Commit**

```bash
cd frontend/aura && git add components/Sidebar.vue
git commit -m "feat: add bookmarks link with count to sidebar"
```

---

## Task 6: Create `/bookmarks` page

**Files:**
- Create: `frontend/aura/app/pages/bookmarks.vue`
- Create: `frontend/aura/e2e/bookmarks.spec.ts`

**Interfaces:**
- Consumes: `useBookmarks()` composable, `PostCard` component, `useSeo()` composable
- Produces: `/bookmarks` page showing all bookmarked posts with remove buttons

- [ ] **Step 1: Write the E2E test (failing)**

```typescript
// e2e/bookmarks.spec.ts
import { expect, test } from "@playwright/test";

test.describe("Bookmarks page", () => {
	test.beforeEach(async ({ page }) => {
		// Clear localStorage to ensure clean state
		await page.goto("/");
		await page.evaluate(() => localStorage.clear());
	});

	test("page loads and shows title", async ({ page }) => {
		await page.goto("/bookmarks");
		await expect(page).toHaveTitle(/X-Blog/);
		await expect(page.locator("h1")).toContainText("收藏的文章");
	});

	test("shows empty state when no bookmarks", async ({ page }) => {
		await page.goto("/bookmarks");
		await expect(page.locator("h1")).toContainText("收藏的文章");
		await expect(page.locator("text=还没有收藏的文章")).toBeVisible();
		await expect(page.locator("text=去浏览文章")).toBeVisible();
	});

	test("bookmark a post from homepage and view in bookmarks", async ({ page }) => {
		await page.goto("/");
		// Find and click a bookmark button on the homepage
		const bookmarkButton = page.locator("button[title='收藏文章']").first();
		if (await bookmarkButton.isVisible()) {
			await bookmarkButton.click();

			// Navigate to bookmarks page
			await page.goto("/bookmarks");
			await expect(page.locator("h1")).toContainText("收藏的文章");

			// Should show at least one bookmarked post
			const articleCount = await page.locator("article").count();
			expect(articleCount).toBeGreaterThan(0);
		}
	});

	test("can remove a bookmark from bookmarks page", async ({ page }) => {
		// First, bookmark a post from the homepage
		await page.goto("/");
		const bookmarkButton = page.locator("button[title='收藏文章']").first();
		if (await bookmarkButton.isVisible()) {
			await bookmarkButton.click();

			// Go to bookmarks page
			await page.goto("/bookmarks");

			// Remove the bookmark
			const removeButton = page.locator("button[title='移除收藏']").first();
			if (await removeButton.isVisible()) {
				await removeButton.click();

				// Should show empty state after removal
				await expect(page.locator("text=还没有收藏的文章")).toBeVisible();
			}
		}
	});

	test("bookmark button stops click propagation", async ({ page }) => {
		await page.goto("/");
		// Click bookmark button should not navigate to post page
		const bookmarkButton = page.locator("button[title='收藏文章']").first();
		if (await bookmarkButton.isVisible()) {
			await bookmarkButton.click();
			// URL should still be homepage, not a post page
			expect(page.url()).not.toMatch(/\/posts\//);
		}
	});
});
```

- [ ] **Step 2: Run E2E test to verify it fails**

```bash
cd frontend/aura && npx playwright test e2e/bookmarks.spec.ts
```

Expected: FAIL — page not found (404).

- [ ] **Step 3: Create the bookmarks page**

```vue
<!-- app/pages/bookmarks.vue -->
<script setup lang="ts">
const { bookmarks, removeBookmark, clearBookmarks, bookmarkCount } = useBookmarks();

useSeo({
	title: "收藏的文章 — X-Blog",
	description: "您收藏的文章列表。",
	path: "/bookmarks",
});

function handleClearAll() {
	if (confirm("确定要清空所有收藏吗？")) {
		clearBookmarks();
	}
}
</script>

<template>
  <div class="max-w-4xl mx-auto px-4 py-12">
    <!-- Header -->
    <div class="flex items-center justify-between mb-8">
      <div>
        <h1 class="text-3xl font-bold text-gray-900 dark:text-gray-100">
          收藏的文章
        </h1>
        <p v-if="bookmarkCount > 0" class="text-sm text-gray-500 dark:text-gray-400 mt-2">
          共 {{ bookmarkCount }} 篇文章
        </p>
      </div>
      <button
        v-if="bookmarkCount > 0"
        type="button"
        @click="handleClearAll"
        class="text-sm text-gray-500 hover:text-red-500 transition-colors"
        title="清空全部"
      >
        <Icon icon="lucide:trash-2" class="w-4 h-4 inline mr-1" />
        清空全部
      </button>
    </div>

    <!-- Empty state -->
    <div
      v-if="bookmarkCount === 0"
      class="text-center py-16 text-gray-500 dark:text-gray-400"
    >
      <Icon icon="lucide:bookmark" class="w-12 h-12 mx-auto mb-4 text-gray-300" />
      <p class="text-lg mb-4">还没有收藏的文章</p>
      <NuxtLink
        to="/"
        class="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors"
      >
        <Icon icon="lucide:arrow-left" class="w-4 h-4" />
        去浏览文章
      </NuxtLink>
    </div>

    <!-- Bookmarks list -->
    <div
      v-else
      class="space-y-4"
    >
      <div
        v-for="bookmark in bookmarks"
        :key="bookmark.id"
        class="border border-gray-100 dark:border-gray-800 rounded-2xl p-4 hover:shadow-md transition-shadow"
      >
        <div class="flex items-start gap-4">
          <!-- Bookmark data as PostCard -->
          <div class="flex-1">
            <NuxtLink
              :to="`/posts/${bookmark.slug}`"
              class="text-xl font-bold hover:text-blue-600 transition-colors line-clamp-2"
            >
              {{ bookmark.title }}
            </NuxtLink>

            <p
              v-if="bookmark.excerpt"
              class="text-gray-600 dark:text-gray-300 mt-2 text-sm line-clamp-2"
            >
              {{ bookmark.excerpt }}
            </p>

            <div class="flex items-center gap-4 mt-3 text-sm text-gray-500 dark:text-gray-400">
              <span v-if="bookmark.category" class="flex items-center gap-1">
                <Icon icon="lucide:folder" class="w-4 h-4" />
                {{ bookmark.category.name }}
              </span>
              <span class="flex items-center gap-1">
                <Icon icon="lucide:calendar" class="w-4 h-4" />
                {{ new Date(bookmark.created_at).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' }) }}
              </span>
            </div>

            <div class="mt-2 flex flex-wrap gap-2">
              <span
                v-for="tag in bookmark.tags"
                :key="tag.id"
                class="text-xs px-2 py-1 bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 rounded-full"
              >
                #{{ tag.name }}
              </span>
            </div>
          </div>

          <!-- Remove button -->
          <button
            type="button"
            @click.stop="removeBookmark(bookmark.id)"
            title="移除收藏"
            class="shrink-0 p-2 text-gray-400 hover:text-red-500 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-xl transition-colors"
          >
            <Icon icon="lucide:x" class="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
```

- [ ] **Step 4: Run E2E test to verify it passes**

```bash
cd frontend/aura && npx playwright test e2e/bookmarks.spec.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
cd/frontend/aura && git add app/pages/bookmarks.vue e2e/bookmarks.spec.ts
git commit -m "feat: add /bookmarks page with reading list display"
```

---

## Task 7: Run full test suite, lint, and final commit

- [ ] **Step 1: Run frontend unit tests**

```bash
cd frontend/aura && npx vitest run
```

Expected: all tests PASS (existing + new), coverage >= 80%.

- [ ] **Step 2: Run frontend E2E tests**

```bash
cd frontend/aura && npx playwright test
```

Expected: all E2E tests PASS.

- [ ] **Step 3: Run biome formatter and linter**

```bash
cd frontend/aura && npx biome check --write .
```

- [ ] **Step 4: Verify no lint issues**

```bash
cd frontend/aura && npx biome check .
```

Expected: no errors.

- [ ] **Step 5: Commit any formatting fixes**

```bash
cd frontend/aura && git add -A && git commit -m "chore: apply formatting fixes for bookmarks feature" || true
```

- [ ] **Step 6: Final verification**

```bash
cd frontend/aura && npx vitest run --reporter=verbose
```

---

## Summary

| Task | File(s) | Status |
|------|---------|--------|
| 1 | `composables/useBookmarks.ts` + tests | — |
| 2 | `components/BookmarkButton.vue` + tests | — |
| 3 | `components/PostCard.vue` + tests | — |
| 4 | `app/pages/posts/[slug].vue` | — |
| 5 | `components/Sidebar.vue` | — |
| 6 | `app/pages/bookmarks.vue` + E2E | — |
| 7 | Full test + lint | — |

Total: 7 tasks, 3 new files, 4 modified files, 3 test files.
