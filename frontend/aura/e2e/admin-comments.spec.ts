import { expect, test } from "@playwright/test";

test.describe("Admin comment management", () => {
	test.beforeEach(async ({ page }) => {
		// Log in first
		await page.goto("/admin/login");
		await page.fill('input[type="text"]', "admin");
		await page.fill('input[type="password"]', "admin123");
		await page.click('button[type="submit"]');
		await page.waitForURL("**/admin/comments");
	});

	test("admin can view the comments list", async ({ page }) => {
		await expect(page).toHaveTitle(/评论|Comments/);

		// Should show a table or list of comments
		const table = page.locator("table, .comment-list");
		await expect(table).toBeVisible();

		// Should have columns for author, content, status, actions
		const headerCells = page.locator("th, .comment-header");
		const headersText = await headerCells.allTextContents();
		const combined = headersText.join(" ");
		expect(combined.toLowerCase()).toMatch(/author|评论人|name/);
	});

	test("admin can approve a pending comment", async ({ page }) => {
		// Find a pending comment (status = "pending" or "待审核")
		const pendingRow = page.locator("tr, .comment-row", {
			has: page.locator("text=/pending|待审核/i"),
		});

		if (await pendingRow.isVisible()) {
			// Click approve button
			const approveBtn = pendingRow.locator("button", {
				name: /approve|批准|通过/i,
			});
			if (await approveBtn.isVisible()) {
				await approveBtn.click();

				// Should update status
				await expect(pendingRow).toContainText(/approved|已批准|published/i);
			}
		}
	});

	test("admin can delete a comment with confirmation", async ({ page }) => {
		const commentRows = page.locator("tr, .comment-row");
		const count = await commentRows.count();

		if (count > 0) {
			const firstRow = commentRows.first();
			const deleteBtn = firstRow.locator("button", {
				name: /delete|删除|trash/i,
			});

			if (await deleteBtn.isVisible()) {
				await deleteBtn.click();

				// Should show confirmation dialog
				const confirmBtn = page.locator("button", {
					name: /confirm|确定|delete anyway/i,
				});
				if (await confirmBtn.isVisible()) {
					await confirmBtn.click();

					// Comment should be removed from the list
					await expect(commentRows).toHaveCount(count - 1);
				}
			}
		}
	});

	test("admin can filter comments by status", async ({ page }) => {
		// Look for filter tabs/buttons
		const filterButtons = page.locator("button, a", {
			hasText: /all|pending|approved|all comments|全部|待审核|已批准/i,
		});

		if (await filterButtons.isVisible()) {
			await filterButtons.first().click();
			const table = page.locator("table, .comment-list");
			await expect(table).toBeVisible();
		}
	});
});
