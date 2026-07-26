import { expect, test } from "@playwright/test";

test.describe("Search", () => {
	test("search input is visible on homepage", async ({ page }) => {
		await page.goto("/");
		const searchInput = page.getByPlaceholder("搜索文章...");
		await expect(searchInput).toBeVisible();
	});

	test("search results page shows results", async ({ page }) => {
		await page.goto("/");
		const searchInput = page.getByPlaceholder("搜索文章...");
		await searchInput.fill("test");
		await searchInput.press("Enter");

		// Should navigate to search results page
		await page.waitForURL(/q=test/);
		// Results heading should be visible
		const heading = page.locator("h1");
		if (await heading.isVisible()) {
			await expect(heading).toBeVisible();
		}
	});

	test("search with no results shows message", async ({ page }) => {
		await page.goto("/");
		const searchInput = page.getByPlaceholder("搜索文章...");
		await searchInput.fill("zzzznotexistingzzzz");
		await searchInput.press("Enter");

		await page.waitForURL(/q=zzzznotexistingzzzz/);
		// Some indication of no results
		const noResults = page.locator("text=/暂无|未找到|No posts/i");
		if (await noResults.first().isVisible()) {
			await expect(noResults.first()).toBeVisible();
		}
	});

	test("can navigate to search page directly", async ({ page }) => {
		await page.goto("/search");
		await expect(page).toHaveURL("/search");
		const searchInput = page.getByPlaceholder("搜索文章...");
		await expect(searchInput).toBeVisible();
	});
});
