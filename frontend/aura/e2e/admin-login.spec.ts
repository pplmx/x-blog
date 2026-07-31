import { expect, test } from "@playwright/test";

test.describe("Admin authentication and post management", () => {
	test("admin can log in and view posts list", async ({ page }) => {
		// Navigate to login page
		await page.goto("/admin/login");

		// Fill in credentials
		await page.fill('input[type="text"]', "admin");
		await page.fill('input[type="password"]', "admin123");

		// Click login
		await page.click('button[type="submit"]');

		// Should redirect to /admin/posts
		await page.waitForURL("**/admin/posts");
		await expect(page).toHaveTitle(/文章列表|文章管理|Posts/);

		// Should show the posts table or list
		const postsSection = page.locator("h1");
		await expect(postsSection).toContainText("文章");
	});

	test("admin can log out", async ({ page }) => {
		// Log in first
		await page.goto("/admin/login");
		await page.fill('input[type="text"]', "admin");
		await page.fill('input[type="password"]', "admin123");
		await page.click('button[type="submit"]');
		await page.waitForURL("**/admin/posts");

		// Click logout (should be in the sidebar or header)
		const logoutButton = page.locator('button:has-text("退出")');
		if (await logoutButton.isVisible()) {
			await logoutButton.click();
			await page.waitForURL("**/admin/login");
		}
	});

	test("invalid credentials show error", async ({ page }) => {
		await page.goto("/admin/login");
		await page.fill('input[type="text"]', "wrong");
		await page.fill('input[type="password"]', "wrong");
		await page.click('button[type="submit"]');

		// Should show error message
		const errorElement = page.locator("text=/登录失败|用户名或密码错误|Invalid/");
		await expect(errorElement).toBeVisible();
	});
});
