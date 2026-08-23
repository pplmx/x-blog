/**
 * Home "Latest from your follows" journey (DEC-142, TASK-183).
 *
 * A signed-in reader who follows a category sees the newest public posts from
 * their follows in a "Latest from your follows" row on the home page. Guests
 * see no row.
 */

import { expect, test } from "@playwright/test";

const PASSWORD = "e2epass123";
let emailCounter = 0;
function freshEmail(): string {
	emailCounter += 1;
	return `follows-feed-${Date.now()}-${emailCounter}@example.com`;
}

function tokenHeader(token: string): Record<string, string> {
	return { Authorization: `Bearer ${token}` };
}

test.describe("Home 'Latest from your follows' row (TASK-183)", () => {
	test("guests see no Latest-from-your-follows row", async ({ page }) => {
		await page.goto("/");
		await expect(page.locator("section", { hasText: "关注内容的最新文章" })).toHaveCount(0);
	});

	test("a signed-in reader sees posts from a followed category", async ({ page, request }) => {
		// Find a category that has at least one published post to follow.
		const cats = await request.get("/api/categories");
		expect(cats.status()).toBe(200);
		const categoryList = (await cats.json()) as Array<{ id: number }>;
		let target: { id: number } | null = null;
		let expectedTitle: string | null = null;
		for (const cat of categoryList) {
			const posts = await request.get(`/api/posts?category_id=${cat.id}&limit=1`);
			const data = (await posts.json()) as { items: Array<{ title: string }> };
			if (data.items?.length) {
				target = cat;
				expectedTitle = data.items[0].title;
				break;
			}
		}
		if (!target) {
			test.skip();
			return;
		}

		// Register a reader, sign the app in, and follow the category.
		const email = freshEmail();
		const reg = await request.post("/api/reader/register", {
			data: { email, password: PASSWORD, display_name: "Follows Feed E2E" },
		});
		expect(reg.status()).toBe(201);
		const token = ((await reg.json()) as { access_token: string }).access_token;
		await page.addInitScript((tk) => localStorage.setItem("reader_token", tk), token);

		const follow = await request.put(`/api/reader/me/categories/${target.id}/follow`, {
			headers: tokenHeader(token),
		});
		expect(follow.status()).toBe(201);

		// The home page shows the followed category's post in the row.
		await page.goto("/");
		const row = page.locator("section", { hasText: "关注内容的最新文章" });
		await expect(row).toBeVisible({ timeout: 10000 });
		await expect(row).toContainText(expectedTitle ?? "");
	});
});
