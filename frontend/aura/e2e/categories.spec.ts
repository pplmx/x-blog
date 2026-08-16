import { expect, test } from "@playwright/test";

test.describe("Categories page", () => {
	test("loads and shows the categories header", async ({ page }) => {
		await page.goto("/categories");
		await expect(page.locator("h1")).toBeVisible();
	});
});
