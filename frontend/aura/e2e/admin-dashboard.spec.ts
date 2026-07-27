import { expect, test } from "@playwright/test";

test.describe("Admin dashboard and statistics", () => {
	test.beforeEach(async ({ page }) => {
		// Log in first
		await page.goto("/admin/login");
		await page.fill('input[type="text"]', "admin");
		await page.fill('input[type="password"]', "admin123");
		await page.click('button[type="submit"]');
		await page.waitForURL("**/admin");
	});

	test("admin can view the dashboard", async ({ page }) => {
		await expect(page).toHaveTitle(/仪表盘|Dashboard|控制台|Admin/);

		// Should show a dashboard layout
		const dashboard = page.locator(".dashboard, .stats, .admin-dashboard");
		await expect(dashboard).toBeVisible();
	});

	test("dashboard displays statistics cards", async ({ page }) => {
		// Should show statistics for posts, comments, categories, tags
		const statCards = page.locator(".stat-card, .stats-card, .dashboard-card");
		await expect(statCards).toHaveCount({ min: 1 });

		// Check for common stat labels
		const statText = await page.locator(".stat-card, .stats-card, .dashboard-card").allTextContents();
		const combined = statText.join(" ").toLowerCase();
		expect(combined).toMatch(/post|文章|comment|评论|category|分类|tag|标签|views|浏览|user|用户/);
	});

	test("dashboard shows post statistics", async ({ page }) => {
		// Should show total posts count
		const postStat = page.locator("text=/posts|文章/", { exact: false });
		await expect(postStat).toBeVisible();
	});

	test("dashboard shows comment statistics", async ({ page }) => {
		// Should show total comments count
		const commentStat = page.locator("text=/comments|评论/", { exact: false });
		await expect(commentStat).toBeVisible();
	});

	test("admin can navigate to other admin sections from dashboard", async ({ page }) => {
		// Should have links to posts, comments, categories, tags
		const navLinks = page.locator("a", {
			hasText: /posts|comments|categories|tags|文章|评论|分类|标签/i,
		});

		// Should have at least a few navigation links
		await expect(navLinks).toHaveCount({ min: 1 });

		// Should have a posts link that navigates correctly
		const postsLink = page.locator("a", { hasText: /posts|文章列表/i });
		if (await postsLink.isVisible()) {
			await postsLink.click();
			await page.waitForURL("**/admin/posts");
			await expect(page).toHaveTitle(/文章列表|Posts/);
		}
	});
});
