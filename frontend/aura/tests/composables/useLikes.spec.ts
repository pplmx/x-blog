import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useLikes } from "../../composables/useLikes.ts";

beforeEach(() => {
	localStorage.clear();
});

afterEach(() => {
	localStorage.clear();
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
});
