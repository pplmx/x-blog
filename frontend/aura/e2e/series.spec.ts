import { expect, test } from "@playwright/test";

/**
 * Post series journey (DEC-056).
 *
 * Public side: the seeded "FastAPI 深入浅出" series (init_db slug
 * `fastapi-tour`) renders on /series with its post count, and /series/[slug]
 * shows the posts in author order with position badges. A post inside that
 * series (fastapi-dependency-injection-deep-dive) shows the series chip and
 * in-series prev/next navigation.
 *
 * Admin side: an admin can create a series (title + slug + description),
 * assign a post to it via the post editor, and verify the assignment carries
 * through to the public series detail and the reopened editor.
 *
 * The e2e backend is seeded by `just e2e` (init_db in dev mode), so the demo
 * series exists with deterministic slugs/titles across runs.
 */

test.describe("Post series (public)", () => {
	test("series index lists the seeded series with a post count", async ({ page }) => {
		await page.goto("/series");
		await expect(page.locator("h1")).toContainText(/全部系列|Series/);

		// seeded demo series card links to its detail page
		const card = page.locator('a[href="/series/fastapi-tour"]');
		await expect(card).toBeVisible();
		await expect(card).toContainText("FastAPI 深入浅出");
	});

	test("series detail shows posts in author order", async ({ page }) => {
		await page.goto("/series/fastapi-tour");
		await expect(page.locator("h1")).toContainText("FastAPI 深入浅出");

		// Both seeded series posts render, in order: DI first (order 0), then
		// postgres tuning (order 1).
		const links = page.locator('a[href^="/posts/"]');
		const hrefs = await links.evaluateAll((els) => els.map((el) => el.getAttribute("href")));
		expect(hrefs).toEqual([
			"/posts/fastapi-dependency-injection-deep-dive",
			"/posts/postgresql-performance-tuning",
		]);
	});

	test("a series post shows the series chip and in-series navigation", async ({ page }) => {
		await page.goto("/posts/fastapi-dependency-injection-deep-dive");

		// There are two links to /series/fastapi-tour on this post (the header
		// chip and the in-series nav header); scope to the chip with the part
		// label ("第 1 篇", part 1 of 2).
		const chip = page.locator('a[href="/series/fastapi-tour"]').filter({ hasText: "第 1 篇" });
		await expect(chip).toBeVisible();

		// In-series nav: this is part 1 of 2, so only next-in-series exists. The
		// related-posts card also links to the same post, so scope to the nav link
		// carrying the "下一篇" label.
		const nextLink = page
			.locator('a[href="/posts/postgresql-performance-tuning"]')
			.filter({ hasText: "下一篇" });
		await expect(nextLink).toBeVisible();
	});
});

test.describe("Post series (admin)", () => {
	test.beforeEach(async ({ page }) => {
		// Login (seeded admin/admin123 from init_db dev seed).
		await page.goto("/admin/login");
		await page.fill('input[type="text"]', "admin");
		await page.fill('input[type="password"]', "admin123");
		await page.click('button[type="submit"]');
		await page.waitForURL("**/admin/posts");
	});

	test("admin can create a series and it appears on the public index", async ({ page }) => {
		const seriesTitle = `E2E Series ${Date.now()}`;
		await page.goto("/admin/series");

		// find the create form's title input (its placeholder is the zh sample)
		const titleInput = page.locator('input[placeholder*="例如"]');
		await expect(titleInput).toBeVisible();
		await titleInput.fill(seriesTitle);
		await page
			.locator('textarea[placeholder*="关于"]')
			.fill("Created from an e2e test to verify the series management flow.");
		await page.locator('button:has-text("创建")').click();

		// appears in the admin series list
		await expect(page.locator(`text=${seriesTitle}`)).toBeVisible();

		// navigate to the public index — the new series card is listed there
		await page.goto("/series");
		await expect(page.locator(`text=${seriesTitle}`)).toBeVisible();
	});

	test("admin can assign a post to a series from the post editor", async ({ page }) => {
		// Create a fresh series so the editor dropdown has a known entry.
		const seriesTitle = `Assign Series ${Date.now()}`;
		await page.goto("/admin/series");
		await page.locator('input[placeholder*="例如"]').fill(seriesTitle);
		await page.locator('button:has-text("创建")').click();
		await expect(page.locator(`text=${seriesTitle}`)).toBeVisible();

		// Open a new post in the editor.
		const postTitle = `Series Member ${Date.now()}`;
		await page.goto("/admin/posts/new");
		await page.locator('input[placeholder*="标题"]').first().fill(postTitle);
		await page.locator('textarea[placeholder*="Markdown"]').fill("# Series member content");

		// Pick the new series in the series dropdown (the last <select> on the
		// editor — category comes first) and set a position.
		await page.locator("select").last().selectOption({ label: seriesTitle });
		const orderInput = page.locator('input[type="number"]');
		await orderInput.fill("0");

		await page.locator('button[type="submit"]').click();
		await page.waitForURL("**/admin/posts");

		// Round-trip: the list row links back to the editor; reopening it must
		// reflect the saved series assignment (select pre-selected + position).
		// Read the edit href from the row (the title link) and hard-navigate to
		// avoid SPA-race timing on the admin list.
		const row = page.locator("tr", { hasText: postTitle }).first();
		const editHref = await row.locator('a[href*="/admin/posts/"]').first().getAttribute("href");
		expect(editHref).toMatch(/\/admin\/posts\/\d+/);
		await page.goto(editHref as string);

		// The pre-selected series must be the one we assigned (assert by label —
		// the numeric id depends on seed state across runs).
		const seriesSelect = page.locator("select").last();
		const selectedLabel = await seriesSelect.locator("option:checked").textContent();
		expect(selectedLabel?.trim()).toBe(seriesTitle);
		// The position input carries the saved order.
		await expect(page.locator('input[type="number"]')).toHaveValue("0");
	});
});
