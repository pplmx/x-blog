/**
 * Reading-insights journey (DEC-417, TASK-434).
 *
 * A signed-in reader who has viewed a post opens /history: beside the
 * streak/heatmap, the reading-insights panel shows "read in the last 30 days"
 * with a live count and the most-read categories — the "what/how much" shape
 * of their reading, served by /me/history/insights.
 */

import { expect, test } from "@playwright/test";

const PASSWORD = "e2epass123";
let emailCounter = 0;
function freshEmail(): string {
	emailCounter += 1;
	return `insights-${Date.now()}-${emailCounter}@example.com`;
}

async function registerAndLoginReader(
	page: import("@playwright/test").Page,
	request: import("@playwright/test").APIRequestContext,
	email: string,
): Promise<string> {
	const reg = await request.post("/api/reader/register", {
		data: { email, password: PASSWORD, display_name: "Insights E2E" },
	});
	expect(reg.status()).toBe(201);

	await page.goto("/login");
	await page.locator("main input[type='email']").fill(email);
	await page.locator('input[type="password"]').fill(PASSWORD);
	await page.locator("main form").press("Enter");
	await page.waitForURL("**/bookmarks");

	const login = await request.post("/api/reader/login", { data: { email, password: PASSWORD } });
	return (await login.json()).access_token as string;
}

test.describe("Reading insights (DEC-417)", () => {
	test("a signed-in reader sees their 30-day volume and categories on /history", async ({
		page,
		request,
	}) => {
		const email = freshEmail();
		const readerToken = await registerAndLoginReader(page, request, email);

		// Record a few views so the aggregate is non-zero.
		const feed = await request.get("/api/posts?limit=2");
		expect(feed.status()).toBe(200);
		const posts = ((await feed.json()) as { items: Array<{ id: number }> }).items;
		expect(posts.length).toBeGreaterThan(0);
		for (const p of posts.slice(0, 2)) {
			const view = await request.post(`/api/reader/me/history/${p.id}`, {
				headers: { Authorization: `Bearer ${readerToken}` },
			});
			expect(view.status()).toBe(200);
		}

		await page.goto("/history");
		// The insights panel (signed-in only) renders beside the stats.
		await expect(page.locator("text=最近 30 天读过")).toBeVisible({ timeout: 10000 });
		await expect(page.locator("text=常读分类")).toBeVisible({ timeout: 10000 });
		// The 30-day count is a live number (the sibling paragraph under the
		// card title) — at least the two seeded views from today.
		const count = page
			.locator("text=最近 30 天读过")
			.locator("xpath=following-sibling::p[1]");
		await expect(count).toHaveText(/\d+/);
		// The category chips carry the viewed posts' categories — the seed data
		// covers them, so at least one chip (a rounded-full span) is present.
		await expect(
			page.locator("div.rounded-2xl.border", { hasText: "常读分类" }).locator("span.rounded-full").first(),
		).toBeVisible({ timeout: 10000 });
	});
});
