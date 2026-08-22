/**
 * Admin Settings journey (DEC-100, TASK-162).
 *
 * An admin opens /admin/settings, sees the verified-reader auto-approve toggle,
 * flips it, saves, and the updated value persists (a "saved" confirmation
 * appears). The persisted setting overrides the env fallback the comment-create
 * path reads, so the trust tier can be flipped at runtime without a redeploy.
 */

import { expect, test } from "@playwright/test";

test.describe("Admin settings", () => {
	test.beforeEach(async ({ page }) => {
		await page.goto("/admin/login");
		await page.fill('input[type="text"]', "admin");
		await page.fill('input[type="password"]', "admin123");
		await page.click('button[type="submit"]');
		await page.waitForURL("**/admin/posts");
		await page.goto("/admin/settings");
		await expect(page.locator('input[type="checkbox"]')).toBeVisible({ timeout: 10000 });
	});

	test("admin can toggle and save the auto-approve setting", async ({ page }) => {
		const checkbox = page.locator('input[type="checkbox"]');
		const wasChecked = await checkbox.isChecked();
		// Flip it to the opposite state and save.
		if (wasChecked) {
			await checkbox.uncheck();
		} else {
			await checkbox.check();
		}
		await page.locator('button:has-text("保存")').click();
		await expect(page.locator("text=设置已保存")).toBeVisible({ timeout: 10000 });

		// The control reflects the saved state after a reload.
		await page.reload();
		await expect(page.locator('input[type="checkbox"]')).toBeVisible({ timeout: 10000 });
		expect(await page.locator('input[type="checkbox"]').isChecked()).not.toBe(wasChecked);
	});
});
