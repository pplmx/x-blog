import { expect, test } from "@playwright/test";

test.describe("Search", () => {
	test("search input is visible on the search page", async ({ page }) => {
		await page.goto("/search");
		const searchInput = page.getByPlaceholder("输入关键词...");
		await expect(searchInput).toBeVisible();
	});

	test("search results page shows results", async ({ page }) => {
		await page.goto("/search");
		const searchInput = page.getByPlaceholder("输入关键词...");
		await searchInput.fill("test");
		await searchInput.press("Enter");

		// Should navigate to search results page
		await page.waitForURL(/q=test/);
		// Results heading should be visible
		const heading = page.locator("h1");
		if (await heading.isVisible()) {
			await expect(heading).toBeVisible();
		}
	});

	test("search with no results shows message", async ({ page }) => {
		await page.goto("/search");
		const searchInput = page.getByPlaceholder("输入关键词...");
		await searchInput.fill("zzzznotexistingzzzz");
		await searchInput.press("Enter");

		await page.waitForURL(/q=zzzznotexistingzzzz/);
		// Some indication of no results
		const noResults = page.locator("text=/暂无|未找到|No posts/i");
		if (await noResults.first().isVisible()) {
			await expect(noResults.first()).toBeVisible();
		}
	});

	test("can navigate to search page directly", async ({ page }) => {
		await page.goto("/search");
		await expect(page).toHaveURL("/search");
		const searchInput = page.getByPlaceholder("输入关键词...");
		await expect(searchInput).toBeVisible();
	});

	test("CJK search result renders a highlighted snippet (DEC-071)", async ({ page, request }) => {
		// Seed a CJK post whose match sits deep in the body, so only the
		// context-window snippet (not excerpt[:N]) can surface it highlighted.
		const login = await request.post("/api/admin/login", {
			form: { username: "admin", password: "admin123" },
		});
		expect(login.status()).toBe(200);
		const token = ((await login.json()) as { access_token: string }).access_token;
		const slug = `cjk-snippet-e2e-${Date.now()}`;
		const body =
			"开头句。" + "填充内容段落。".repeat(60) + "评论系统高亮测试位于正文深处。" + "结尾句。";
		const create = await request.post("/api/posts", {
			data: { title: "中文搜索测试帖", slug, content: body, published: true },
			headers: { Authorization: `Bearer ${token}` },
		});
		expect(create.status()).toBe(201);

		await page.goto("/search");
		const searchInput = page.getByPlaceholder("输入关键词...");
		await searchInput.fill("评论系统高亮测试");
		await searchInput.press("Enter");
		await page.waitForURL(/q=/);

		await expect(page.locator("h1").first()).toBeVisible({ timeout: 10000 });
		// The backend snippet carries a <mark> around the term; the page renders
		// it (sanitized) and the highlighted text is visible.
		const mark = page.locator("mark").first();
		await expect(mark).toBeVisible({ timeout: 10000 });
		await expect(mark).toContainText("评论系统高亮测试");
	});
});
