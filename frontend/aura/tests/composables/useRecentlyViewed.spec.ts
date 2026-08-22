/**
 * useRecentlyViewed composable tests (DEC-104, TASK-164; TASK-169).
 *
 * The continue-reading trail records posts most-recent-first, dedups by slug,
 * timestamps every entry, and caps the list so the localStorage blob stays
 * bounded and predictable. TASK-169 raised the cap so /history can show a
 * browseable trail while the home row still slices to a small subset.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { useRecentlyViewed } from "../../composables/useRecentlyViewed";

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
});
