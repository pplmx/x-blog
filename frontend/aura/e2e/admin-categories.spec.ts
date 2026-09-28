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

	test("admin can delete a category with confirmation", async ({ page, request }) => {
		// Create a uniquely-named category via the API so the row to delete is
		// unambiguous, then assert the FINAL state (name gone) instead of a
		// count delta — the old count-derived assertion raced the delete
		// re-render and flaked under serial-suite load (e2e#54).
		const name = `待删除分类-${Date.now()}`;
		const admin = await request.post("/api/admin/login", {
			form: { username: "admin", password: "admin123" },
		});
		const token = ((await admin.json()) as { access_token: string }).access_token;
		const created = await request.post("/api/admin/categories", {
			data: { name },
			headers: { Authorization: `Bearer ${token}` },
		});
		expect(created.ok()).toBe(true);
		const categoryId = ((await created.json()) as { id: number }).id;

		// The row is present (scoped to the list-row container so the search
		// input wrapper's hasText match can't shadow it). Note: substring
		// match, NOT exact — the name <span> also holds the post_count badge,
		// so the element text is "<name> 0"; exact:true can never match, and
		// the negative assertion below would be vacuously true.
		await page.goto("/admin/categories");
		const row = page.locator(".space-y-3 > div", { hasText: name }).first();
		await expect(page.getByText(name)).toBeVisible({ timeout: 10000 });

		// Delete it; the page uses window.confirm for delete confirmation.
		page.on("dialog", (dialog) => dialog.accept());
		await row.getByRole("button", { name: "删除" }).click();

		// FINAL state: the named row leaves the DOM (not a count delta race).
		await expect(page.getByText(name)).not.toBeVisible({ timeout: 10000 });

		// Clean up if the UI delete somehow failed — never leave a duplicate
		// "待删除分类" row behind for subsequent runs (idempotent).
		await request
			.delete(`/api/admin/categories/${categoryId}`, {
				headers: { Authorization: `Bearer ${token}` },
			})
			.catch(() => {});
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
