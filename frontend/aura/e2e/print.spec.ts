/**
 * Print / PDF view journey (DEC-112, TASK-168).
 *
 * A reader can open the print-friendly route for any post and get a clean
 * article: navigate to the print route from the article page's "Print / PDF"
 * link, then assert the post title and rendered content are present and the
 * print toolbar is visible on screen (the toolbar is hidden only when printed
 * via the @media print rules).
 */

import { expect, test } from "@playwright/test";

async function firstPost(
	request: import("@playwright/test").APIRequestContext,
): Promise<{ slug: string; title: string }> {
	const resp = await request.get("/api/posts?limit=1");
	expect(resp.status()).toBe(200);
	const body = (await resp.json()) as { items: Array<{ slug: string; title: string }> };
	expect(body.items.length).toBeGreaterThan(0);
	return body.items[0];
}

test.describe("Print / PDF view (TASK-168)", () => {
	test("reader opens the print route and sees the article content", async ({ page, request }) => {
		const post = await firstPost(request);

		// The article page exposes a "Print / PDF" entry link to the print route.
		await page.goto(`/posts/${post.slug}`);
		const printLink = page.locator(`a[href='/posts/${post.slug}/print'], a[href*='/print']`);
		await expect(printLink.first()).toBeVisible({ timeout: 10000 });

		// Open the print route: title and rendered content are present, and the
		// screen-only toolbar (Print/PDF button) is visible.
		await printLink.first().click();
		await page.waitForURL(`**/posts/${post.slug}/print`);
		await expect(page.locator("h1").first()).toBeVisible({ timeout: 10000 });
		await expect(page.locator("article, [class*='prose'], [class*='content']").first()).toBeVisible(
			{ timeout: 10000 },
		);

		// The Print/PDF toolbar button is present on screen.
		await expect(page.locator("button", { hasText: /打印|Print/i }).first()).toBeVisible();
	});
});
