import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useLikes } from "../../composables/useLikes.ts";

beforeEach(() => {
	localStorage.clear();
});

afterEach(() => {
	localStorage.clear();
	vi.restoreAllMocks();
});

describe("useLikes", () => {
	it("isLiked returns false initially for a post", () => {
		const { isLiked } = useLikes();
		expect(isLiked(1)).toBe(false);
	});

	it("recordLike marks a post liked", () => {
		const { isLiked, recordLike, persist } = useLikes();
		recordLike(42);
		persist();
		expect(isLiked(42)).toBe(true);
	});

	it("undoLike un-marks a post", () => {
		const { isLiked, recordLike, undoLike, persist } = useLikes();
		recordLike(7);
		persist();
		expect(isLiked(7)).toBe(true);
		undoLike(7);
		expect(isLiked(7)).toBe(false);
	});

	it("persists to localStorage and reloads on a fresh call", () => {
		{
			const { recordLike, persist } = useLikes();
			recordLike(99);
			persist();
		}
		const fresh = useLikes();
		expect(fresh.isLiked(99)).toBe(true);
	});

	it("does not mark liked when window is undefined (SSR safe)", () => {
		const original = global.window;
		// @ts-expect-error — intentionally remove window for SSR test
		delete global.window;
		const { recordLike, isLiked } = useLikes();
		recordLike(5);
		expect(isLiked(5)).toBe(false);
		global.window = original;
	});

	it("treats corrupt localStorage JSON as an empty liked set", () => {
		localStorage.setItem("x_blog_liked_posts", "{not valid json");
		const { isLiked } = useLikes();
		expect(isLiked(1)).toBe(false);
	});

	it("treats a non-array localStorage payload as an empty liked set", () => {
		localStorage.setItem("x_blog_liked_posts", JSON.stringify({ id: 1 }));
		const { isLiked } = useLikes();
		expect(isLiked(1)).toBe(false);
	});

	it("swallows storage failures on persist (storage unavailable)", () => {
		const original = localStorage.setItem;
		// Simulate a full/unavailable storage so the catch path in
		// saveToStorage runs; it must not throw.
		localStorage.setItem = vi.fn().mockImplementation(() => {
			throw new Error("QuotaExceededError");
		});
		const { recordLike, persist } = useLikes();
		recordLike(3);
		expect(() => persist()).not.toThrow();
		localStorage.setItem = original;
	});
});

describe("useLikes in Nuxt mode (useState stubbed)", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("re-reads storage client-side when the SSR-initialized set is empty", () => {
		// Simulate a server-rendered empty state plus a client storage that
		// already holds a like from a previous visit.
		localStorage.setItem("x_blog_liked_posts", JSON.stringify([7]));
		const ssrState = { value: new Set<number>() };
		vi.stubGlobal("useState", () => ssrState);

		const { isLiked, liked } = useLikes();
		expect(liked.value.has(7)).toBe(true);
		expect(isLiked(7)).toBe(true);
	});

	it("keeps the existing SSR-initialized set when it is non-empty", () => {
		localStorage.setItem("x_blog_liked_posts", JSON.stringify([7]));
		const ssrState = { value: new Set<number>([3]) };
		vi.stubGlobal("useState", () => ssrState);

		const { isLiked } = useLikes();
		expect(isLiked(3)).toBe(true);
		expect(isLiked(7)).toBe(false); // no re-read when size > 0
	});
});

describe("useLikes without window (SSR)", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("load/record/undo/persist are crash-free no-ops", () => {
		vi.stubGlobal("window", undefined);
		const { liked, recordLike, undoLike, persist, isLiked } = useLikes();
		recordLike(1);
		undoLike(1);
		expect(() => persist()).not.toThrow();
		expect(liked.value.size).toBe(0);
		expect(isLiked(1)).toBe(false);
	});
});
