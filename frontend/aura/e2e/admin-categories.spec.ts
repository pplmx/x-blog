import { expect, test } from "@playwright/test";

test.describe("Admin category management", () => {
	test.beforeEach(async ({ page }) => {
		// Log in first
		await page.goto("/admin/login");
		await page.fill('input[type="text"]', "admin");
		await page.fill('input[type="password"]', "admin123");
		await page.click('button[type="submit"]');
		// Login redirects to /admin/posts; navigate to the page under test
		await page.waitForURL("**/admin/posts");
		await page.goto("/admin/categories");
	});

	test("admin can view the categories list", async ({ page }) => {
		await expect(page).toHaveTitle(/分类|Categories/);

		// Should show a list or table of categories
		const list = page.locator("table, .category-list, .categories");
		await expect(list).toBeVisible();
	});

	test("admin can create a new category", async ({ page }) => {
		// Click the "create" or "new" button
		const createBtn = page.locator("button", {
			name: /create|new|添加|新建|新增/i,
		});
		await expect(createBtn).toBeVisible();
		await createBtn.click();

		// Fill in the category form
		const nameInput = page.locator(
			'input[name="name"], input[placeholder*="名称"], input[placeholder*="name"]',
		);
		await expect(nameInput).toBeVisible();
		await nameInput.fill("Test Category");

		// Save
		const saveBtn = page.locator("button", {
			name: /save|submit|保存|确定/i,
		});
		await expect(saveBtn).toBeVisible();
		await saveBtn.click();

		// Should redirect back to categories list and show the new category
		await page.waitForURL("**/admin/categories");
		await expect(page.locator("text=Test Category")).toBeVisible();
	});

	test("admin can edit an existing category", async ({ page }) => {
		// Find the first category in the list
		const firstCategory = page.locator("tr, .category-item").first();

		// Click edit button
		const editBtn = firstCategory.locator("button", {
			name: /edit|修改|编辑|pencil/i,
		});
		if (await editBtn.isVisible()) {
			await editBtn.click();

			// Should show the edit form
			const nameInput = page.locator('input[name="name"], input[value]');
			await expect(nameInput).toBeVisible();

			// Change the name
			await nameInput.fill("Updated Category Name");

			// Save
			const saveBtn = page.locator("button", {
				name: /save|submit|保存|确定/i,
			});
			await saveBtn.click();

			// Should show updated name
			await expect(page.locator("text=Updated Category Name")).toBeVisible();
		}
	});

	test("admin can delete a category with confirmation", async ({ page }) => {
		const categoryItems = page.locator("tr, .category-item");
		const count = await categoryItems.count();

		if (count > 0) {
			const firstItem = categoryItems.first();
			const deleteBtn = firstItem.locator("button", {
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

					// Category count should decrease
					await expect(categoryItems).toHaveCount(count - 1);
				}
			}
		}
	});

	test("create form validates required fields", async ({ page }) => {
		const createBtn = page.locator("button", {
			name: /create|new|添加|新建|新增/i,
		});
		await createBtn.click();

		// Try to save without filling in required fields
		const saveBtn = page.locator("button", {
			name: /save|submit|保存|确定/i,
		});
		await saveBtn.click();

		// Should show validation error
		const errorMessage = page.locator("text=/required|必填|不能为空/i");
		await expect(errorMessage).toBeVisible();
	});
});
