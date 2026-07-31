import { expect, test } from "@playwright/test";

test.describe("SEO & Feeds", () => {
	test("RSS feed is accessible", async ({ page }) => {
		const response = await page.goto("/rss/feed.xml");
		expect(response?.status()).toBe(200);
		// Read the response body — page.content() returns the browser's XML
		// viewer wrapper (escaped XML inside HTML)
		const body = await response?.text();
		expect(body).toContain("<rss");
		expect(body).toContain("<channel>");
	});

	test("Atom feed is accessible", async ({ page }) => {
		const response = await page.goto("/rss/atom.xml");
		expect(response?.status()).toBe(200);
		const body = await response?.text();
		expect(body).toContain("<feed");
	});

	test("sitemap.xml is accessible", async ({ page }) => {
		const response = await page.goto("/sitemap.xml");
		expect(response?.status()).toBe(200);
		const body = await response?.text();
		expect(body).toContain("<urlset");
		expect(body).toContain("<loc>");
	});

	test("robots.txt is accessible", async ({ page }) => {
		const response = await page.goto("/robots.txt");
		expect(response?.status()).toBe(200);
		const body = await response?.text();
		expect(body).toMatch(/User-?agent/i);
		expect(body).toContain("Sitemap");
	});

	test("page has proper meta description", async ({ page }) => {
		await page.goto("/");
		const meta = page.locator('meta[name="description"]');
		await expect(meta).toHaveAttribute("content");
	});

	test("page has Open Graph tags", async ({ page }) => {
		await page.goto("/");
		const ogTitle = page.locator('meta[property="og:title"]');
		await expect(ogTitle).toHaveAttribute("content");
	});

	test("page has Twitter Card tags", async ({ page }) => {
		await page.goto("/");
		const twitterCard = page.locator('meta[name="twitter:card"]');
		await expect(twitterCard).toHaveAttribute("content");
	});
});
