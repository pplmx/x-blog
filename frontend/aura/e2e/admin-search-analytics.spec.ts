/**
 * Search analytics journey (DEC-152, TASK-188).
 *
 * A public search is logged (aggregate) and the top terms appear on the admin
 * dashboard, so the operator sees what readers look for.
 */

import { expect, test } from "@playwright/test";

const stamp = Date.now();

test.describe("Admin search analytics (TASK-188)", () => {
	test("a public search shows up in the admin dashboard top searches", async ({
		page,
		request,
	}) => {
		// Perform a public search to log an aggregate term.
		const term = `e2esearch${stamp}`;
		const search = await request.get("/api/search", { params: { q: term } });
		expect(search.status()).toBe(200);

		// Log in as admin and open the dashboard.
		await page.goto("/admin/login");
		await page.fill('input[type="text"]', "admin");
		await page.fill('input[type="password"]', "admin123");
		await page.click('button[type="submit"]');
		await page.waitForURL("**/admin/posts");
		await page.goto("/admin");

		const searchesCard = page.locator("div", { hasText: "热门搜索" }).first();
		await expect(searchesCard).toBeVisible({ timeout: 10000 });
		await expect(searchesCard).toContainText(term);
	});
});
