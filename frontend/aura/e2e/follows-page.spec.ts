/**
 * Dedicated /follows page journey (DEC-292, TASK-375).
 *
 * The home page caps "Latest from your follows" at 12 posts; /follows is the
 * full paginated feed of every new post from the reader's followed categories
 * + series + tags. Guests are redirected to /login (it is auth-scoped). A
 * signed-in reader who follows a category reaches the page via the home row's
 * "View all" link and sees that category's posts there.
 */

import { expect, test } from "@playwright/test";

const PASSWORD = "e2epass123";
let emailCounter = 0;
function freshEmail(): string {
	emailCounter += 1;
	return `follows-page-${Date.now()}-${emailCounter}@example.com`;
}

function tokenHeader(token: string): Record<string, string> {
	return { Authorization: `Bearer ${token}` };
}

test.describe("/follows page (DEC-292)", () => {
	test("guests are redirected to /login (auth-scoped feed)", async ({ page }) => {
		await page.goto("/follows");
		await expect(page).toHaveURL(/\/login/, { timeout: 10000 });
	});

	test("a signed-in reader browses followed posts via the home row's View-all link", async ({
		page,
		request,
	}) => {
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
			data: { email, password: PASSWORD, display_name: "Follows Page E2E" },
		});
		expect(reg.status()).toBe(201);
		const token = ((await reg.json()) as { access_token: string }).access_token;
		await page.addInitScript((tk) => localStorage.setItem("reader_token", tk), token);

		const follow = await request.put(`/api/reader/me/categories/${target.id}/follow`, {
			headers: tokenHeader(token),
		});
		expect(follow.status()).toBe(201);

		// The home row shows the post AND a "View all" link into /follows.
		await page.goto("/");
		const row = page.locator("section", { hasText: "关注内容的最新文章" });
		await expect(row).toBeVisible({ timeout: 10000 });
		const viewAll = row.getByRole("link", { name: /查看全部/ });
		await expect(viewAll).toBeVisible();

		await viewAll.click();
		await expect(page).toHaveURL(/\/follows/, { timeout: 10000 });

		// The /follows page lists the followed post (title) and shows the count.
		await expect(page.getByRole("heading", { name: "我的关注" })).toBeVisible();
		await expect(page.locator("main")).toContainText(expectedTitle ?? "", {
			timeout: 10000,
		});
	});
});
