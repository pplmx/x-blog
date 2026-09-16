import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";

import { type Bookmark, useBookmarks } from "../../composables/useBookmarks.ts";

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

	describe("setDone / queue counts (round 361, DEC-395)", () => {
		it("starts every bookmark in the To-read queue", () => {
			const { addBookmark, toReadCount, doneCount } = useBookmarks();
			addBookmark(mockBookmark);
			expect(toReadCount.value).toBe(1);
			expect(doneCount.value).toBe(0);
		});

		it("marks a bookmark Done (immutably) and moves counts", () => {
			const { bookmarks, addBookmark, setDone, toReadCount, doneCount } = useBookmarks();
			addBookmark(mockBookmark);
			setDone(1, true);
			expect(bookmarks.value[0].done).toBe(true);
			expect(toReadCount.value).toBe(0);
			expect(doneCount.value).toBe(1);
		});

		it("moves a Done bookmark back to To-read", () => {
			const { bookmarks, addBookmark, setDone, toReadCount, doneCount } = useBookmarks();
			addBookmark(mockBookmark);
			setDone(1, true);
			setDone(1, false);
			expect(bookmarks.value[0].done).toBe(false);
			expect(toReadCount.value).toBe(1);
			expect(doneCount.value).toBe(0);
		});

		it("ignores an unknown id (no throw, no list change)", () => {
			const { bookmarks, addBookmark, setDone } = useBookmarks();
			addBookmark(mockBookmark);
			setDone(999, true);
			expect(bookmarks.value[0].done).toBeUndefined();
		});

		it("persists the done flag to localStorage", () => {
			const { addBookmark, setDone } = useBookmarks();
			addBookmark(mockBookmark);
			setDone(1, true);
			const stored = JSON.parse(localStorage.getItem("x_blog_bookmarks") ?? "[]") as Bookmark[];
			expect(stored[0].done).toBe(true);
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
			// addBookmark should be a no-op in SSR
			addBookmark(mockBookmark);
			expect(bookmarks.value).toEqual([]);
			global.window = originalWindow;
		});
	});

	describe("shared state (RIL ISS-036)", () => {
		it("two useBookmarks() calls share one reactive array under useState", () => {
			// Simulate the Nuxt runtime where useState is a keyed singleton:
			// both calls must resolve to the same backing ref.
			const shared = ref<Bookmark[]>([]);
			vi.stubGlobal("useState", () => shared);

			const a = useBookmarks();
			const b = useBookmarks();
			// Adding via one instance must be visible via the other immediately
			a.addBookmark(mockBookmark);
			expect(b.isBookmarked(1)).toBe(true);
			expect(b.bookmarkCount.value).toBe(1);
			b.removeBookmark(1);
			expect(a.isBookmarked(1)).toBe(false);
			vi.unstubAllGlobals();
		});
	});
});
