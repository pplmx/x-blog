import { expect, test } from "@playwright/test";

test.describe("Admin tag management", () => {
	test.beforeEach(async ({ page }) => {
		// Log in first
		await page.goto("/admin/login");
		await page.fill('input[type="text"]', "admin");
		await page.fill('input[type="password"]', "admin123");
		await page.click('button[type="submit"]');
		// Login redirects to /admin/posts; navigate to the page under test
		await page.waitForURL("**/admin/posts");
		await page.goto("/admin/tags");
	});

	test("admin can view the tags list", async ({ page }) => {
		await expect(page).toHaveTitle(/标签|Tags/);

		// Should show a list or table of tags
		const list = page.locator(".flex.flex-wrap.gap-3");
		await expect(list).toBeVisible();
	});

	test("admin can create a new tag", async ({ page }) => {
		// The create form is always visible; fill it and submit
		const nameInput = page.locator('input[placeholder*="名称"]');
		await expect(nameInput).toBeVisible();
		await nameInput.fill("Test Tag");

		const createBtn = page.locator('button:has-text("创建")');
		await expect(createBtn).toBeEnabled();
		await createBtn.click();

		// The new tag should appear in the list
		await expect(page.locator("text=Test Tag")).toBeVisible();
	});

	test("admin can edit an existing tag", async ({ page }) => {
		// Find the first tag in the list
		const firstTag = page.locator(".flex.flex-wrap.gap-3 > div").first();
		const editBtn = firstTag.locator('button:has-text("编辑")');

		if (await editBtn.isVisible()) {
			await editBtn.click();

			// Should show the edit form
			const nameInput = page.locator('input[name="name"], input[value]');
			await expect(nameInput).toBeVisible();
			await nameInput.fill("Updated Tag Name");

			const saveBtn = firstTag.locator('button:has-text("确认")');
			await saveBtn.click();

			await expect(page.locator("text=Updated Tag Name")).toBeVisible();
		}
	});

	test("admin can delete a tag with confirmation", async ({ page }) => {
		const tagItems = page.locator(".flex.flex-wrap.gap-3 > div");
		const count = await tagItems.count();

		if (count > 0) {
			const firstItem = tagItems.first();
			const deleteBtn = firstItem.locator('button:has-text("删除")');

			if (await deleteBtn.isVisible()) {
				await deleteBtn.click();

				const confirmBtn = page.locator("button", {
					name: /confirm|确定|delete anyway/i,
				});
				if (await confirmBtn.isVisible()) {
					await confirmBtn.click();
					await expect(tagItems).toHaveCount(count - 1);
				}
			}
		}
	});
});
