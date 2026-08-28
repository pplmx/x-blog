/**
 * Bookmark search journey (DEC-124, TASK-174).
 *
 * A reader with saved posts can type into the /bookmarks search box and see
 * only matching posts (by title/category/tag); clearing restores the full list.
 */

import { expect, test } from "@playwright/test";

const PASSWORD = "e2epass123";
let emailCounter = 0;
function freshEmail(): string {
	emailCounter += 1;
	return `reader-${Date.now()}-${emailCounter}@example.com`;
}

async function bookmarkPost(page: import("@playwright/test").Page, href: string): Promise<string> {
	await page.goto(href);
	await page.locator("button[title='收藏文章']").first().click();
	await expect(page.locator("button[title*='取消收藏']").first()).toBeVisible({ timeout: 5000 });
	const title = (await page.locator("h1").first().textContent()) ?? "";
	return title.trim();
}

test.describe("Bookmark search (TASK-174)", () => {
	test("search filters the saved list and clears", async ({ page, request }) => {
		const email = freshEmail();
		const reg = await request.post("/api/reader/register", {
			data: { email, password: PASSWORD, display_name: "Search E2E" },
		});
		expect(reg.status()).toBe(201);
		const token = ((await reg.json()) as { access_token: string }).access_token;
		await page.addInitScript((tk) => localStorage.setItem("reader_token", tk), token);

		// Bookmark the first two published posts.
		await page.goto("/");
		const postLinks = page.locator("article a[href*='/posts/']");
		await postLinks.first().waitFor({ state: "visible" });
		const firstHref = (await postLinks.nth(0).getAttribute("href")) ?? "";
		const secondHref = (await postLinks.nth(1).getAttribute("href")) ?? "";
		const firstTitle = await bookmarkPost(page, firstHref);
		await bookmarkPost(page, secondHref);

		await page.goto("/bookmarks");
		// The header's global site search is also an input[type="search"]; scope
		// to THIS page's bookmark filter via its placeholder (strict mode).
		const search = page.getByPlaceholder("搜索收藏…");
		await expect(search).toBeVisible({ timeout: 10000 });

		// Typing the first post's title narrows the list to it.
		await search.fill(firstTitle.slice(0, 12));
		await expect(page.locator("main").getByText(firstTitle).first()).toBeVisible();
		await expect(page.locator("body")).toContainText(/共 1 篇文章/);

		// Clearing restores the full list.
		await page.locator('button[aria-label="清除搜索"]').click();
		await expect(page.locator("body")).toContainText(/共 2 篇文章/);
	});
});
