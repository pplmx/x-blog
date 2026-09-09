/**
 * useRecentlyViewed composable tests (DEC-104, TASK-164; TASK-169).
 *
 * The continue-reading trail records posts most-recent-first, dedups by slug,
 * timestamps every entry, and caps the list so the localStorage blob stays
 * bounded and predictable. TASK-169 raised the cap so /history can show a
 * browseable trail while the home row still slices to a small subset.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { useRecentlyViewed } from "../../composables/useRecentlyViewed";

/** 31 days in ms — used to build entries older than the prune window. */
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

describe("useRecentlyViewed", () => {
	beforeEach(() => {
		localStorage.clear();
		useRecentlyViewed().clear();
	});

	it("records posts most-recent-first and dedups by slug", () => {
		const { record, recent } = useRecentlyViewed();
		record({ slug: "a", title: "A" });
		record({ slug: "b", title: "B" });
		record({ slug: "a", title: "A" }); // revisiting A moves it to the front
		expect(recent.value.map((x) => x.slug)).toEqual(["a", "b"]);
	});

	it("stamps every recorded entry with a viewedAt timestamp (TASK-169)", () => {
		const { record, recent } = useRecentlyViewed();
		const before = Date.now();
		record({ slug: "a", title: "A" });
		expect(recent.value[0].viewedAt).toBeDefined();
		expect(Number(recent.value[0].viewedAt)).toBeGreaterThanOrEqual(before);
		expect(Number(recent.value[0].viewedAt)).toBeLessThanOrEqual(Date.now());
	});

	it("revisiting a post refreshes its viewedAt and moves it to the front", () => {
		const { record, recent } = useRecentlyViewed();
		record({ slug: "a", title: "A" });
		record({ slug: "b", title: "B" });
		const firstStamp = Number(recent.value[0].viewedAt);
		record({ slug: "a", title: "A" });
		expect(recent.value.map((x) => x.slug)).toEqual(["a", "b"]);
		// The refreshed entry has a newer timestamp than the other list entry.
		expect(Number(recent.value[0].viewedAt)).toBeGreaterThanOrEqual(firstStamp);
	});

	it("caps the trail at 50 entries, keeping the most recent first (TASK-169)", () => {
		const { record, recent } = useRecentlyViewed();
		for (let i = 0; i < 60; i++) record({ slug: `s${i}`, title: `T${i}` });
		expect(recent.value.length).toBe(50);
		expect(recent.value[0].slug).toBe("s59");
		expect(recent.value[49].slug).toBe("s10");
	});

	it("persists across instances (reads from localStorage)", () => {
		useRecentlyViewed().record({ slug: "x", title: "X" });
		// A fresh call re-reads the same persisted trail (module mirror).
		const { recent } = useRecentlyViewed();
		expect(recent.value.map((x) => x.slug)).toEqual(["x"]);
	});

	it("clear empties the trail", () => {
		const { record, clear, recent } = useRecentlyViewed();
		record({ slug: "a", title: "A" });
		expect(recent.value.length).toBe(1);
		clear();
		expect(recent.value.length).toBe(0);
	});

	it("ignores records without a slug or title", () => {
		const { record, recent } = useRecentlyViewed();
		record({ slug: "", title: "Empty slug" });
		record({ slug: "ok", title: "" });
		record({ slug: "", title: "" });
		record({ slug: "good", title: "Good" });
		expect(recent.value.map((x) => x.slug)).toEqual(["good"]);
	});

	// The module-scoped `recent` mirror is read from localStorage exactly once at
	// module load, so reading a SEEDED trail requires a fresh module import.
	describe("persisted-trail reads (fresh module per case)", () => {
		it("treats a corrupt or non-array persisted trail as empty", async () => {
			vi.resetModules();
			localStorage.clear();
			localStorage.setItem("recently-viewed", "not json");
			let mod = await import("../../composables/useRecentlyViewed");
			expect(mod.useRecentlyViewed().recent.value).toEqual([]);

			vi.resetModules();
			localStorage.setItem("recently-viewed", JSON.stringify({ slug: "not-an-array" }));
			mod = await import("../../composables/useRecentlyViewed");
			expect(mod.useRecentlyViewed().recent.value).toEqual([]);
		});

		it("drops persisted entries that lack a slug or title", async () => {
			vi.resetModules();
			localStorage.clear();
			localStorage.setItem(
				"recently-viewed",
				JSON.stringify([
					{ slug: "ok", title: "T" },
					{ title: "no slug" },
					{ slug: "no title" },
					null,
				]),
			);
			const { useRecentlyViewed } = await import("../../composables/useRecentlyViewed");
			expect(useRecentlyViewed().recent.value.map((x) => x.slug)).toEqual(["ok"]);
		});

		it("prunes stale timestamps while keeping legacy entries that predate them", async () => {
			vi.resetModules();
			localStorage.clear();
			const stale = { slug: "old", title: "Old", viewedAt: Date.now() - (MAX_AGE_MS + 1000) };
			const legacy = { slug: "legacy", title: "Legacy" }; // no timestamp field
			const fresh = { slug: "fresh", title: "Fresh", viewedAt: Date.now() };
			localStorage.setItem("recently-viewed", JSON.stringify([stale, legacy, fresh]));

			const { useRecentlyViewed } = await import("../../composables/useRecentlyViewed");
			const { recent } = useRecentlyViewed();
			expect(recent.value.map((x) => x.slug)).toEqual(["legacy", "fresh"]);
		});
	});

	it("still records in memory when localStorage is unavailable", () => {
		const originalLS = window.localStorage;
		Object.defineProperty(window, "localStorage", { value: undefined, configurable: true });
		try {
			useRecentlyViewed().clear();
			const { record, recent } = useRecentlyViewed();
			record({ slug: "a", title: "A" });
			// read()/write() are inert without storage, but the in-memory mirror
			// still updates this visit (no crash).
			expect(recent.value[0]?.slug).toBe("a");
		} finally {
			Object.defineProperty(window, "localStorage", { value: originalLS, configurable: true });
		}
	});
});
