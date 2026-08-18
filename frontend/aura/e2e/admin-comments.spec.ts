import { expect, test } from "@playwright/test";

test.describe("Admin comment management", () => {
	test.beforeEach(async ({ page }) => {
		// Log in first
		await page.goto("/admin/login");
		await page.fill('input[type="text"]', "admin");
		await page.fill('input[type="password"]', "admin123");
		await page.click('button[type="submit"]');
		// Login redirects to /admin/posts; navigate to the page under test
		await page.waitForURL("**/admin/posts");
		await page.goto("/admin/comments");
	});

	test("admin can view the comments list", async ({ page }) => {
		await expect(page).toHaveTitle(/评论|Comments/);

		// Comments render as cards in a .space-y-3 list
		const list = page.locator(".space-y-3");
		await expect(list).toBeVisible();

		// Cards show moderation status and action buttons
		const listText = (await list.textContent()) || "";
		expect(listText).toMatch(/待审核|已审核|通过|删除/);
	});

	test("admin can approve a pending comment", async ({ page }) => {
		// Find a pending comment (status = "pending" or "待审核")
		const pendingRow = page.locator(".space-y-3 > div", { hasText: "待审核" }).first();

		if (await pendingRow.isVisible()) {
			// Click approve button
			const approveBtn = pendingRow.locator('button:has-text("通过")');
			if (await approveBtn.isVisible()) {
				await approveBtn.click();

				// Should update status
				await expect(pendingRow).toContainText(/approved|已批准|published/i);
			}
		}
	});

	test("admin can delete a comment with confirmation", async ({ page }) => {
		const commentRows = page.locator(".space-y-3 > div");
		const count = await commentRows.count();

		if (count > 0) {
			const firstRow = commentRows.first();
			const deleteBtn = firstRow.locator('button:has-text("删除")');

			if (await deleteBtn.isVisible()) {
				// The page uses window.confirm for delete confirmation
				page.on("dialog", (dialog) => dialog.accept());
				await deleteBtn.click();

				// Comment should be removed from the list
				await expect(commentRows).toHaveCount(count - 1);
			}
		}
	});

	test("admin can filter comments by status", async ({ page }) => {
		// Status filters are the "全部/待审核/已审核" (zh) / "All/Pending/Approved"
		// (en) buttons in the filter bar. getByRole("button") keeps the label
		// match from grabbing the status badge spans rendered on comment cards.
		const pendingFilter = page.getByRole("button", {
			name: /待审核|pending/i,
		});
		await pendingFilter.click();

		// Comments render as cards in .space-y-3, not a table (the seeded DB has
		// two pending comments: 王五 and spam_bot), so the filtered list stays
		// visible and every card carries the "待审核/Pending" badge.
		const list = page.locator(".space-y-3");
		await expect(list).toBeVisible({ timeout: 10000 });
		const badges = list.locator('span:has-text("待审核"), span:has-text("Pending")');
		expect(await badges.count()).toBe(await list.locator("> div").count());
	});
});
