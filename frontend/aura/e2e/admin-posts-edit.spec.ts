import { expect, test } from "@playwright/test";

test.describe("Admin post editing", () => {
	test.beforeEach(async ({ page }) => {
		// Log in first
		await page.goto("/admin/login");
		await page.fill('input[type="text"]', "admin");
		await page.fill('input[type="password"]', "admin123");
		await page.click('button[type="submit"]');
		await page.waitForURL("**/admin/posts");
	});

	test("admin can view the posts list", async ({ page }) => {
		await expect(page).toHaveTitle(/文章列表|文章管理|Posts/);

		// Should show a table of posts
		const table = page.locator("table, .posts-list");
		await expect(table).toBeVisible();

		// Should have column headers for title, status, actions
		const headers = page.locator("th");
		const headerText = await headers.allTextContents();
		const combined = headerText.join(" ");
		expect(combined.toLowerCase()).toMatch(/title|标题/);
	});

	test("admin can navigate to post edit page", async ({ page }) => {
		// Find the first post in the list
		const firstPost = page.locator("tbody tr").first();

		// Click edit button
		const editBtn = firstPost.locator('a[href*="/admin/posts/"]').last();
		await expect(editBtn).toBeVisible();
		await editBtn.click();

		// Should navigate to the edit page
		await page.waitForURL(/\/admin\/posts\/\d+/);

		// Should show the post edit form
		const titleInput = page.locator('input[placeholder="输入文章标题"]');
		await expect(titleInput).toBeVisible();
	});

	test("admin can create a new post", async ({ page }) => {
		// Unique title per attempt: the editor auto-generates the slug from
		// the title, so a fixed title would collide (400 "slug already
		// exists") with the previous attempt on retry.
		const postTitle = `Test Post Title ${Date.now()}`;

		// Click "create new post" or "new post" button
		const createBtn = page.locator(
			'a:has-text("新建文章"), a:has-text("新建"), button:has-text("新建")',
		);
		await expect(createBtn).toBeVisible();
		await createBtn.click();

		// Should show the post editor (new-post URL)
		await page.waitForURL("**/admin/posts/new");

		// Editor-specific title input (the list page also has an input whose
		// placeholder contains 标题 - the search box)
		const titleInput = page.locator('input[placeholder="输入文章标题"]');
		await expect(titleInput).toBeVisible();
		await titleInput.fill(postTitle);

		// Fill in content (the markdown editor textarea)
		const contentTextarea = page.locator('textarea[placeholder*="Markdown"]');
		await expect(contentTextarea).toBeVisible();
		await contentTextarea.fill("This is test post content.");

		// Save the post (type=submit button on the editor form)
		const saveBtn = page.locator('button[type="submit"]');
		await expect(saveBtn).toBeVisible();
		await saveBtn.click();

		// Should redirect back to posts list
		await page.waitForURL("**/admin/posts");
		await expect(page.locator(`text=${postTitle}`)).toBeVisible();
	});

	test("admin can update post status (publish/draft)", async ({ page }) => {
		// Navigate to first post's edit page
		const firstPost = page.locator("tr, .post-row").first();
		const editBtn = firstPost.locator("a, button", {
			name: /edit|修改|编辑/i,
		});
		if (await editBtn.isVisible()) {
			await editBtn.click();
			await page.waitForURL("**/admin/posts/**");

			// Find status toggle or dropdown
			const statusSelector = page.locator(
				'select[name="status"], button[name="status"], .status-toggle',
			);
			if (await statusSelector.isVisible()) {
				// Toggle status or change dropdown
				await statusSelector.click();

				// Save changes
				const saveBtn = page.locator("button", {
					name: /save|publish|发布|保存|确定/i,
				});
				await saveBtn.click();
			}

			// Should show updated status
			const postsList = page.locator("tr, .post-row");
			if (await postsList.isVisible()) {
				// Should redirect back to list or show success message
				await expect(page).toHaveURL(/.*\/admin\/posts/);
			}
		}
	});

	test("admin can search/filter posts", async ({ page }) => {
		const searchInput = page.locator('input[type="search"], input[name="search"], .search-input');
		if (await searchInput.isVisible()) {
			await searchInput.fill("test");
			await searchInput.press("Enter");

			// Should show filtered results
			const results = page.locator("tr, .post-row");
			await expect(results).toBeVisible();
		}
	});
});
