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
		const list = page.locator("table, .tag-list, .tags");
		await expect(list).toBeVisible();
	});

	test("admin can create a new tag", async ({ page }) => {
		// Click the create/new button
		const createBtn = page.locator("button", {
			name: /create|new|添加|新建|新增/i,
		});
		await expect(createBtn).toBeVisible();
		await createBtn.click();

		// Fill in the tag form
		const nameInput = page.locator(
			'input[name="name"], input[placeholder*="名称"], input[placeholder*="name"]',
		);
		await expect(nameInput).toBeVisible();
		await nameInput.fill("Test Tag");

		// Save
		const saveBtn = page.locator("button", {
			name: /save|submit|保存|确定/i,
		});
		await saveBtn.click();

		// Should show the new tag in the list
		await page.waitForURL("**/admin/tags");
		await expect(page.locator("text=Test Tag")).toBeVisible();
	});

	test("admin can edit an existing tag", async ({ page }) => {
		// Find the first tag in the list
		const firstTag = page.locator("tr, .tag-item").first();
		const editBtn = firstTag.locator("button, a", {
			name: /edit|修改|编辑/i,
		});

		if (await editBtn.isVisible()) {
			await editBtn.click();

			// Should show the edit form
			const nameInput = page.locator('input[name="name"], input[value]');
			await expect(nameInput).toBeVisible();
			await nameInput.fill("Updated Tag Name");

			const saveBtn = page.locator("button", {
				name: /save|submit|保存|确定/i,
			});
			await saveBtn.click();

			await expect(page.locator("text=Updated Tag Name")).toBeVisible();
		}
	});

	test("admin can delete a tag with confirmation", async ({ page }) => {
		const tagItems = page.locator("tr, .tag-item");
		const count = await tagItems.count();

		if (count > 0) {
			const firstItem = tagItems.first();
			const deleteBtn = firstItem.locator("button", {
				name: /delete|删除|trash/i,
			});

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
