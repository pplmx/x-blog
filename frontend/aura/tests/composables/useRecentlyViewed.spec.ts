/**
 * useRecentlyViewed composable tests (DEC-104, TASK-164).
 *
 * The continue-reading trail records posts most-recent-first, dedups by slug
 * and caps the list so the localStorage blob stays bounded and predictable.
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

	it("caps the trail at 8 entries, keeping the most recent first", () => {
		const { record, recent } = useRecentlyViewed();
		for (let i = 0; i < 12; i++) record({ slug: `s${i}`, title: `T${i}` });
		expect(recent.value.length).toBe(8);
		expect(recent.value[0].slug).toBe("s11");
		expect(recent.value[7].slug).toBe("s4");
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
