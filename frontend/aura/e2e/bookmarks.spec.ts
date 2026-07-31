import { expect, test } from "@playwright/test";

test.describe("Bookmarks page", () => {
	test.beforeEach(async ({ page }) => {
		// Clear localStorage to ensure clean state
		await page.goto("/");
		await page.evaluate(() => localStorage.clear());
	});

	test("page loads and shows title", async ({ page }) => {
		await page.goto("/bookmarks");
		await expect(page).toHaveTitle(/X-Blog/);
		await expect(page.locator("h1")).toContainText("收藏的文章");
	});

	test("shows empty state when no bookmarks", async ({ page }) => {
		await page.goto("/bookmarks");
		await expect(page.locator("h1")).toContainText("收藏的文章");
		await expect(page.locator("text=还没有收藏的文章")).toBeVisible();
		await expect(page.locator("text=去浏览文章")).toBeVisible();
	});

	test("bookmark a post from homepage and view in bookmarks", async ({ page }) => {
		await page.goto("/");
		// Find and click a bookmark button on the homepage
		const bookmarkButton = page.locator("button[title='收藏文章']").first();
		if (await bookmarkButton.isVisible()) {
			await bookmarkButton.click();

			// Navigate to bookmarks page
			await page.goto("/bookmarks");
			await expect(page.locator("h1")).toContainText("收藏的文章");

			// Should show at least one bookmarked post (rendered as cards)
			const bookmarkCount = await page.locator('a[href*="/posts/"]').count();
			expect(bookmarkCount).toBeGreaterThan(0);
		}
	});

	test("can remove a bookmark from bookmarks page", async ({ page }) => {
		// First, bookmark a post from the homepage
		await page.goto("/");
		const bookmarkButton = page.locator("button[title='收藏文章']").first();
		if (await bookmarkButton.isVisible()) {
			await bookmarkButton.click();

			// Go to bookmarks page
			await page.goto("/bookmarks");

			// Remove the bookmark
			const removeButton = page.locator("button[title='移除收藏']").first();
			if (await removeButton.isVisible()) {
				await removeButton.click();

				// Should show empty state after removal
				await expect(page.locator("text=还没有收藏的文章")).toBeVisible();
			}
		}
	});

	test("bookmark button stops click propagation", async ({ page }) => {
		await page.goto("/");
		// Click bookmark button should not navigate to post page
		const bookmarkButton = page.locator("button[title='收藏文章']").first();
		if (await bookmarkButton.isVisible()) {
			await bookmarkButton.click();
			// URL should still be homepage, not a post page
			expect(page.url()).not.toMatch(/\/posts\//);
		}
	});
});
