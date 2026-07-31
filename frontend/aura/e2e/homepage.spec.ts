import { expect, test } from "@playwright/test";

test.describe("Homepage", () => {
	test("page loads and shows title", async ({ page }) => {
		await page.goto("/");
		await expect(page).toHaveTitle(/X-Blog/);
	});

	test("displays the blog title", async ({ page }) => {
		await page.goto("/");
		// The header brand shows the site name
		await expect(page.locator("header, nav").first()).toContainText("X-Blog");
	});

	test("shows popular posts section", async ({ page }) => {
		await page.goto("/");
		await expect(page.locator("h2:has-text(\"热门文章\")")).toBeVisible();
	});

	test("shows posts list section", async ({ page }) => {
		await page.goto("/");
		await expect(page.locator("h2:has-text(\"最新文章\")")).toBeVisible();
	});

	test("search box is visible", async ({ page }) => {
		await page.goto("/");
		// The hero links to the search page which hosts the input
		await page.locator('a:has-text("搜索文章")').first().click();
		await expect(page).toHaveURL(/\/search/);
		const searchInput = page.getByPlaceholder("输入关键词...");
		await expect(searchInput).toBeVisible();
	});

	test("search functionality works", async ({ page }) => {
		await page.goto("/search");
		const searchInput = page.getByPlaceholder("输入关键词...");
		await searchInput.fill("test");
		await searchInput.press("Enter");
		await expect(page).toHaveURL(/q=test/);
	});

	test("about page loads", async ({ page }) => {
		await page.goto("/about");
		await expect(page.locator("h1")).toBeVisible();
	});

	test("tags page loads", async ({ page }) => {
		await page.goto("/tags");
		await expect(page.locator("h1")).toBeVisible();
	});

	test("admin page loads", async ({ page }) => {
		await page.goto("/admin");
		await expect(page.locator("h1")).toBeVisible();
	});

	test("pagination works", async ({ page }) => {
		await page.goto("/");
		const nextButton = page.getByRole("link", { name: "下一页" });
		if (await nextButton.isVisible()) {
			await nextButton.click();
			await expect(page).toHaveURL(/page=2/);
		}
	});

	test("category filter works", async ({ page }) => {
		await page.goto("/");
		const categoryLink = page.locator("a[href*='category_id=']").first();
		if (await categoryLink.isVisible()) {
			await categoryLink.click();
			const url = await page.url();
			expect(url).toContain("category_id=");
		}
	});

	test("post detail page loads from homepage", async ({ page }) => {
		await page.goto("/");
		const postLink = page.locator("article a").first();
		if (await postLink.isVisible()) {
			await postLink.click();
			await expect(page.locator("h1")).toBeVisible();
			await expect(page).toHaveURL(/\/posts\//);
		}
	});
});
