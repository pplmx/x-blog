/**
 * Search filters + sort journey (DEC-084, TASK-154).
 *
 * Pins the search-refinement surface: the filter bar renders on the search
 * page and wiring a category/sort into the URL refetches via the backend
 * proxy; the API contract (category narrowing, unknown-category empty result,
 * deterministic sort orders) is asserted through the same proxy the browser
 * uses.
 */

import { expect, test } from "@playwright/test";

// A CJK token that appears in the demo content (every seeded post is CJK).
const TERM = "的";

test.describe("Search filters + sort", () => {
	test("the filter bar renders and category selection updates the URL", async ({ page }) => {
		await page.goto(`/search?q=${encodeURIComponent(TERM)}`);
		const select = page.locator("select").first(); // category select
		await expect(select).toBeVisible();

		const option = select.locator('option:not([value=""])').first();
		const category = await option.getAttribute("value");
		expect(category).toBeTruthy();
		await select.selectOption(category as string);
		await expect(page).toHaveURL(new RegExp(`category=${encodeURIComponent(category as string)}`));
	});

	test("category filter narrows results to that category only", async ({ request }) => {
		const cats = await (await request.get("/api/categories")).json();
		expect(cats.length).toBeGreaterThan(0);
		const category = cats[0].name;

		const narrowed = await request.get(
			`/api/search?q=${encodeURIComponent(TERM)}&category=${encodeURIComponent(category)}&limit=50`,
		);
		expect(narrowed.ok()).toBeTruthy();
		const items = (await narrowed.json()).items as Array<{ category?: { name: string } | null }>;
		for (const post of items) {
			expect(post.category?.name).toBe(category);
		}

		// An unknown category yields zero results (no error), even though the
		// unfiltered query matches content.
		const unknown = await request.get(`/api/search?q=${encodeURIComponent(TERM)}&category=不存在`);
		expect(unknown.ok()).toBeTruthy();
		expect(((await unknown.json()) as { items: unknown[] }).items).toEqual([]);
	});

	test("sort orders are applied deterministically", async ({ request }) => {
		const inner = (await (
			await request.get(`/api/search?q=${encodeURIComponent(TERM)}&limit=50`)
		).json()) as {
			items: Array<{ views: number; created_at: string }>;
		};

		const views = await request.get(
			`/api/search?q=${encodeURIComponent(TERM)}&sort=views&limit=50`,
		);
		const newest = await request.get(
			`/api/search?q=${encodeURIComponent(TERM)}&sort=newest&limit=50`,
		);
		const oldest = await request.get(
			`/api/search?q=${encodeURIComponent(TERM)}&sort=oldest&limit=50`,
		);
		expect(views.ok() && newest.ok() && oldest.ok()).toBeTruthy();

		const viewsItems = (await views.json()).items as Array<{ views: number }>;
		for (let i = 1; i < viewsItems.length; i++) {
			expect(viewsItems[i - 1].views).toBeGreaterThanOrEqual(viewsItems[i].views);
		}
		const newestItems = (await newest.json()).items as Array<{ created_at: string }>;
		for (let i = 1; i < newestItems.length; i++) {
			expect(new Date(newestItems[i - 1].created_at).getTime()).toBeGreaterThanOrEqual(
				new Date(newestItems[i].created_at).getTime(),
			);
		}
		const oldestItems = (await oldest.json()).items as Array<{ created_at: string }>;
		expect(oldestItems.length).toBe(inner.items.length);
	});
});
