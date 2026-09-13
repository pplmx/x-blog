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

	test("sitemap.xml lists series through the Nuxt origin (DEC-318)", async ({ page }) => {
		// The sitemap formerly omitted series entirely and capped the post fetch
		// at 1000 with no pagination. Create a series via the admin API (the
		// global-fetch pattern from admin-editor-role.spec.ts — Playwright's
		// request fixture serializes URLSearchParams bodies differently and 422s
		// the OAuth2 form login), then fetch the sitemap THROUGH the Nuxt origin
		// (where crawlers actually go — the DEC-314 lesson: verify the live
		// request path, not the router alone).
		const API = "http://localhost:18888";
		const login = await fetch(`${API}/api/admin/login`, {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({ username: "admin", password: "admin123" }),
		});
		// Global fetch returns a native Response — `.ok`/`.status` are properties.
		expect(login.ok).toBe(true);
		const { access_token } = (await login.json()) as { access_token: string };

		const slug = `e2e-series-sitemap-${Date.now()}`;
		const created = await fetch(`${API}/api/series`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${access_token}`,
			},
			body: JSON.stringify({
				title: `E2E Sitemap ${slug}`,
				slug,
				description: "sitemap series",
			}),
		});
		expect(created.ok).toBe(true);

		const response = await page.goto("/sitemap.xml");
		expect(response?.status()).toBe(200);
		const body = await response?.text();
		expect(body).toContain(`/series/${slug}`);
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
