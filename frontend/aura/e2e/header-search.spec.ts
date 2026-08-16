/**
 * Header search-as-you-type suggestions (feature TASK-045 / DEC-027).
 *
 * Requires a live backend at the frontend's configured API URL with at least
 * one indexed post (e.g. the seeded "welcome-to-x-blog"). Verifies the
 * combobox contract: typing shows matching suggestions, clicking navigates to
 * the post, Enter lands on the full /search results.
 */

import { expect, test } from "@playwright/test";

test.describe("Header search suggestions", () => {
	test("typing shows matching post suggestions", async ({ page }) => {
		await page.goto("/");
		const input = page.getByRole("combobox");
		await expect(input).toBeVisible();
		await input.fill("Python");
		await expect(page.getByRole("option", { name: /Python 3.14/ })).toBeVisible();
	});

	test("clicking a suggestion navigates to the post", async ({ page }) => {
		await page.goto("/");
		const input = page.getByRole("combobox");
		await input.fill("Python");
		const option = page.getByRole("option", { name: /Python 3.14/ });
		await expect(option).toBeVisible();
		await option.click();
		await page.waitForURL(/\/posts\/python-3-14-new-features/);
	});

	test("Enter navigates to the full search page", async ({ page }) => {
		await page.goto("/");
		const input = page.getByRole("combobox");
		await input.fill("Python");
		await input.press("Enter");
		await page.waitForURL(/\/search\?q=Python/);
	});
});
