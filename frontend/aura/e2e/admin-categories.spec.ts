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

		// Categories render as cards in a .space-y-3 list
		const list = page.locator(".space-y-3");
		await expect(list).toBeVisible();
	});

	test("admin can create a new category", async ({ page }) => {
		// The create form is always visible; fill it and submit
		const nameInput = page.locator('input[placeholder*="名称"]');
		await expect(nameInput).toBeVisible();
		await nameInput.fill("Test Category");

		const createBtn = page.locator('button:has-text("创建")');
		await expect(createBtn).toBeEnabled();
		await createBtn.click();

		// The new category should appear in the list
		await expect(page.locator("text=Test Category")).toBeVisible();
	});

	test("admin can edit an existing category", async ({ page }) => {
		// Find the first category in the list
		const firstCategory = page.locator(".space-y-3 > div").first();

		// Click edit button
		const editBtn = firstCategory.locator('button:has-text("编辑")');
		if (await editBtn.isVisible()) {
			await editBtn.click();

			// Should show the edit form
			const nameInput = firstCategory.locator('input[type="text"]');
			await expect(nameInput).toBeVisible();

			// Change the name
			await nameInput.fill("Updated Category Name");

			// Save
			const saveBtn = firstCategory.locator('button:has-text("确认")');
			await saveBtn.click();

			// Should show updated name
			await expect(page.locator("text=Updated Category Name")).toBeVisible();
		}
	});

	test("admin can delete a category with confirmation", async ({ page }) => {
		const categoryItems = page.locator(".space-y-3 > div");
		const count = await categoryItems.count();

		if (count > 0) {
			const firstItem = categoryItems.first();
			const deleteBtn = firstItem.locator('button:has-text("删除")');

			if (await deleteBtn.isVisible()) {
				// The page uses window.confirm for delete confirmation
				page.on("dialog", (dialog) => dialog.accept());
				await deleteBtn.click();

				// Category count should decrease
				await expect(categoryItems).toHaveCount(count - 1);
			}
		}
	});

	test("create form validates required fields", async ({ page }) => {
		const createBtn = page.locator('button:has-text("创建")');

		// The create button is disabled while the input is empty
		await expect(createBtn).toBeDisabled();

		// Filling the input enables it
		await page.locator('input[placeholder*="名称"]').fill("Validated Category");
		await expect(createBtn).toBeEnabled();
	});
});
