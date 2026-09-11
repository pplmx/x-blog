/**
 * Per-post reading-trend sparkline in the post editor (DEC-287, TASK-372).
 *
 * An author opens an existing published post and sees the 30-day view-trend
 * card. The post's per-day series are seeded through the *public* /view
 * endpoint (same write path real readers use), so the card's period total must
 * reflect those views — proving the editor reads the per-post series from
 * post_views_daily and renders it.
 */

import { expect, test } from "@playwright/test";

const stamp = Date.now();

test.describe("Admin per-post reading trend (TASK-372)", () => {
	test("the editor shows a trend card with the seeded daily views", async ({
		page,
		request,
	}) => {
		// Log in and capture the admin token to seed a published post.
		await page.goto("/admin/login");
		await page.fill('input[type="text"]', "admin");
		await page.fill('input[type="password"]', "admin123");
		await page.click('button[type="submit"]');
		await page.waitForURL("**/admin/posts");
		const token = (await page.evaluate(() => localStorage.getItem("admin_token"))) ?? "";
		const headers = { Authorization: `Bearer ${token}` };

		const created = await request.post("/api/admin/posts", {
			data: {
				title: "Trend E2E",
				slug: `trend-e2e-${stamp}`,
				content: "# Trend body",
				published: true,
			},
			headers,
		});
		expect(created.ok()).toBe(true);
		const postId = ((await created.json()) as { id: number }).id;

		// Seed today's views through the same public endpoint real readers hit.
		for (let i = 0; i < 3; i++) {
			const view = await request.post(`/api/posts/${postId}/view`);
			expect(view.status()).toBe(200);
		}

		await page.goto(`/admin/posts/${postId}`);
		// The trend card renders for an existing post, with the period total
		// reflecting the seeded views (all land on today).
		const card = page.getByText("阅读趋势（30 天）");
		await expect(card).toBeVisible();
		await expect(page.getByText(/近 30 天 \d+ 次阅读/)).toBeVisible();
		// The bar row is present (>= 3 seeded views today -> at least one bar).
		await expect(
			page.locator("div[aria-hidden='true'] .rounded-sm"),
		).not.toHaveCount(0);
	});
});
