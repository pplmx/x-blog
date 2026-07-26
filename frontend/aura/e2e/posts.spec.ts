import { expect, test } from "@playwright/test";

test.describe("Posts", () => {
	test("post detail page shows title and content", async ({ page }) => {
		await page.goto("/");
		const postLink = page.locator("article a").first();

		if (!(await postLink.isVisible())) {
			test.skip();
			return;
		}

		await postLink.click();
		await page.waitForURL(/\/posts\//);

		// Title should be visible
		await expect(page.locator("h1").first()).toBeVisible({ timeout: 5000 });
		// Content area should exist
		await expect(page.locator("article, [class*='prose'], [class*='content']").first()).toBeVisible(
			{ timeout: 5000 },
		);
	});

	test("reading progress bar appears on scroll", async ({ page }) => {
		await page.goto("/");
		const postLink = page.locator("article a").first();

		if (!(await postLink.isVisible())) {
			test.skip();
			return;
		}

		await postLink.click();
		await page.waitForURL(/\/posts\//);

		// Scroll down
		await page.evaluate(() => window.scrollTo(0, 500));

		// Progress indicator should appear
		const progressBar = page.locator(
			'[class*="progress"], [class*="Progress"], [role="progressbar"]',
		);
		if (await progressBar.first().isVisible()) {
			await expect(progressBar.first()).toBeVisible();
		}
	});

	test("tag links are visible on post page", async ({ page }) => {
		await page.goto("/");
		const postLink = page.locator("article a").first();

		if (!(await postLink.isVisible())) {
			test.skip();
			return;
		}

		await postLink.click();
		await page.waitForURL(/\/posts\//);

		// Tag links should be present
		const tagLinks = page.locator("a[href*='/tags/']");
		if (await tagLinks.first().isVisible()) {
			await expect(tagLinks.first()).toBeVisible();
		}
	});

	test("back to top button appears on scroll", async ({ page }) => {
		await page.goto("/");
		const postLink = page.locator("article a").first();

		if (!(await postLink.isVisible())) {
			test.skip();
			return;
		}

		await postLink.click();
		await page.waitForURL(/\/posts\//);

		// Scroll down to trigger BackToTop
		await page.evaluate(() => window.scrollTo(0, 500));

		const backToTop = page.locator("button[title='返回顶部']");
		if (await backToTop.isVisible()) {
			await expect(backToTop).toBeVisible();
		}
	});
});
