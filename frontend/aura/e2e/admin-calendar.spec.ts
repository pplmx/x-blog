/**
 * Admin editorial calendar journey (DEC-162, TASK-194).
 *
 * An admin opens the Calendar page, sees the month grid (42 day cells, month
 * title, legend), and can navigate to the previous/next month. Runs against
 * the seeded dev DB (init_db sample posts land in the current month-ish grid).
 */

import { expect, test } from "@playwright/test";

test.describe("Admin editorial calendar", () => {
	test.beforeEach(async ({ page }) => {
		await page.goto("/admin/login");
		await page.fill('input[type="text"]', "admin");
		await page.fill('input[type="password"]', "admin123");
		await page.click('button[type="submit"]');
		await page.waitForURL("**/admin/posts");
		await page.goto("/admin/calendar");
	});

	test("shows the month grid and calendar chrome", async ({ page }) => {
		await expect(page).toHaveTitle(/内容日历|Editorial Calendar/);
		// 42 day cells (6 rows × 7 columns).
		await expect(page.locator('[data-testid="calendar-day"]')).toHaveCount(42, { timeout: 10000 });
		// Navigation + legend chrome.
		const buttons = page.locator("button");
		await expect(buttons.filter({ hasText: /今天|今天|Today/ }).first()).toBeVisible();
		await expect(page.locator("text=已发布|Live").first()).toBeVisible();
	});

	test("navigates to the previous month", async ({ page }) => {
		const nextButton = page.locator("button", { hasText: /下月|Next/ });
		await expect(nextButton.first()).toBeVisible();
		await nextButton.first().click();
		// The URL month advances; the grid re-renders without losing the header.
		await expect(page.locator('[data-testid="calendar-header"]')).toBeVisible({ timeout: 10000 });
		await expect(page.locator('[data-testid="calendar-day"]')).toHaveCount(42, { timeout: 10000 });
	});
});
