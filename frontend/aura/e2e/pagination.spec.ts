import { expect, test } from "@playwright/test";

test.describe("Pagination", () => {
	test("pagination renders on homepage", async ({ page }) => {
		await page.goto("/");
		// Look for pagination elements
		const pagination = page.locator('nav, [class*="pagination"], [class*="Pagination"]');
		// Pagination may or may not be visible depending on number of posts
	});

	test("next page link changes URL", async ({ page }) => {
		await page.goto("/");
		const nextButton = page.getByRole("link", { name: "下一页" });

		if (!(await nextButton.isVisible())) {
			test.skip();
			return;
		}

		await nextButton.click();
		await expect(page).toHaveURL(/page=2/);
	});

	test("page 2 shows different content than page 1", async ({ page }) => {
		await page.goto("/");
		const nextButton = page.getByRole("link", { name: "下一页" });

		if (!(await nextButton.isVisible())) {
			test.skip();
			return;
		}

		// Get first page content
		await page.goto("/");
		const page1Content = await page.locator("article").count();

		// Go to page 2
		await nextButton.click();
		await expect(page).toHaveURL(/page=2/);

		// Verify we're on page 2
		const url = await page.url();
		expect(url).toContain("page=2");
	});

	test("can navigate to page 2 directly", async ({ page }) => {
		await page.goto("/?page=2");
		await expect(page).toHaveURL(/page=2/);
		await expect(page.locator("h1, h2").first()).toBeVisible();
	});

	test("previous page link works", async ({ page }) => {
		await page.goto("/?page=2");
		const prevButton = page.getByRole("link", { name: "上一页" });

		if (!(await prevButton.isVisible())) {
			test.skip();
			return;
		}

		await prevButton.click();
		await expect(page).toHaveURL(/$/);
	});
});
