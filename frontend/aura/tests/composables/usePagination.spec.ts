/**
 * paginationPages — windowed pagination with ellipsis.
 *
 * Verifies the pure windowing helper: it returns a bounded window of page
 * numbers plus "…" markers around gaps, so a large page count doesn't render
 * one button per page (RIL TASK-083, ISS-052).
 */

import { describe, expect, it } from "vitest";
import { paginationPages } from "../../composables/usePagination.ts";

describe("paginationPages", () => {
	it("returns empty for a single page or fewer", () => {
		expect(paginationPages(1, 1)).toEqual([]);
		expect(paginationPages(0, 1)).toEqual([]);
	});

	it("renders all pages when the total fits in the window", () => {
		expect(paginationPages(5, 3)).toEqual([1, 2, 3, 4, 5]);
	});

	it("windows around a middle current page and adds trailing ellipsis", () => {
		// total 40, current 3 -> window 1..7 then … 40
		const pages = paginationPages(40, 3);
		expect(pages[0]).toBe(1);
		expect(pages).toContain(3);
		expect(pages).toContain(40);
		expect(pages.filter((p) => p === "…").length).toBe(1);
		// Window is bounded (not every page).
		expect(pages.filter((p) => typeof p === "number").length).toBeLessThan(20);
	});

	it("windows around a far current page with leading and trailing ellipsis", () => {
		const pages = paginationPages(100, 50);
		expect(pages[0]).toBe(1);
		expect(pages).toContain(50);
		expect(pages[pages.length - 1]).toBe(100);
		expect(pages.filter((p) => p === "…").length).toBe(2);
	});

	it("keeps the last page visible when current page is near the end", () => {
		const pages = paginationPages(100, 98);
		expect(pages[pages.length - 1]).toBe(100);
		expect(pages).toContain(98);
		// leading ellipsis only (the tail is the window)
		expect(pages[0]).toBe(1);
	});
});
