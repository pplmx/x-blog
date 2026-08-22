/**
 * Per-category / per-series RSS feed journey (DEC-130, TASK-177).
 *
 * The scoped feed endpoints are reachable and return RSS for a category (by
 * unique name) and a series (by slug), and the series/category pages surface a
 * feed link to them.
 */

import { expect, test } from "@playwright/test";

test.describe("Scoped RSS feeds (TASK-177)", () => {
	test("category feed is reachable by name", async ({ request }) => {
		const cats = await request.get("/api/categories");
		expect(cats.status()).toBe(200);
		const category = ((await cats.json()) as Array<{ name: string }>)[0];
		if (!category) {
			test.skip();
			return;
		}
		const feed = await request.get(`/rss/category/${encodeURIComponent(category.name)}.xml`);
		expect(feed.status()).toBe(200);
		expect(feed.headers()["content-type"] ?? "").toContain("application/rss+xml");
	});

	test("series feed is reachable by slug and linked on the series page", async ({
		page,
		request,
	}) => {
		const series = await request.get("/api/series");
		expect(series.status()).toBe(200);
		const list = (await series.json()) as Array<{ slug: string }>;
		if (!list.length) {
			test.skip();
			return;
		}
		const slug = list[0].slug;
		const feed = await request.get(`/rss/series/${slug}.xml`);
		expect(feed.status()).toBe(200);

		// The series page surfaces a link to the scoped feed.
		await page.goto(`/series/${slug}`);
		await expect(page.locator(`a[href="/rss/series/${slug}.xml"]`).first()).toBeVisible({
			timeout: 10000,
		});
	});
});
