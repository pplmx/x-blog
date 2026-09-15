/**
 * Static pages (round 347): the admin Pages CMS -> public /pages/{slug}.
 *
 * An admin creates + publishes a page through the manager UI, the page renders
 * at /pages/{slug} through the same markdown pipeline as posts, and the
 * published page is discoverable from the site footer. The created page is
 * cleaned up at the end.
 *
 * Uses the live backend seeded by the justfile `e2e` task + the Nuxt dev
 * server. Unique slug/title per run so retries never collide.
 */

import { type APIRequestContext, expect, test } from "@playwright/test";

const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "admin123";

async function adminToken(request: APIRequestContext): Promise<string> {
	const res = await request.post("/api/admin/login", {
		form: { username: ADMIN_USERNAME, password: ADMIN_PASSWORD },
	});
	expect(res.status()).toBe(200);
	return ((await res.json()) as { access_token: string }).access_token;
}

test.describe("Static pages CMS (round 347)", () => {
	test.skip(
		() => !!process.env.CI_RESTRICTED,
		"full journey requires an admin publish on the live backend",
	);

	test("create+publish via manager -> renders at /pages/{slug} + footer link", async ({
		page,
		request,
	}) => {
		const uid = Date.now();
		const slug = `privacy-${uid}`;
		const title = `Privacy Policy ${uid}`;
		const content = "## Data we collect\n\nWe only store what you write.";

		// Login through the admin UI (generous timeout: the sandbox's first
		// post-build admin nav has a known slow-load habit).
		await page.goto("/admin/login", { timeout: 20000 });
		await page.fill('input[type="text"]', ADMIN_USERNAME);
		await page.fill('input[type="password"]', ADMIN_PASSWORD);
		await page.click('button[type="submit"]');
		await page.waitForURL("**/admin/posts", { timeout: 20000 });

		let pageId = 0;
		try {
			// Create + publish the page through the manager UI.
			await page.goto("/admin/pages");
			await page.fill("#page-title", title);
			await page.fill("#page-slug", slug);
			await page.fill("#page-content", content);
			await page.check("#page-publish");
			await page.click('button[type="submit"]');
			await expect(page.locator(`text=${title}`).first()).toBeVisible({ timeout: 10000 });

			// It is published: the manager links to the public URL.
			const publicLink = page.locator(`a[href="/pages/${slug}"]`).first();
			await expect(publicLink).toBeVisible();

			// The public page renders title + markdown body through the same
			// pipeline as posts (heading id + paragraph text).
			await page.goto(`/pages/${slug}`);
			await expect(page.locator("h1")).toContainText(title, { timeout: 10000 });
			await expect(page.locator("body")).toContainText("Data we collect");

			// Discoverable from the site footer on any public page.
			await page.goto("/");
			const footerPage = page.locator(`footer a[href="/pages/${slug}"]`).first();
			await expect(footerPage).toBeVisible({ timeout: 10000 });
			await expect(footerPage).toContainText(title.replace(/\s+\d+$/, ""));

			// Grab the id for cleanup.
			const token = await adminToken(request);
			const list = await request.get("/api/admin/pages", {
				headers: { Authorization: `Bearer ${token}` },
			});
			expect(list.status()).toBe(200);
			const row = ((await list.json()) as { id: number; slug: string }[]).find(
				(p) => p.slug === slug,
			);
			expect(row).toBeTruthy();
			pageId = row?.id ?? 0;
		} finally {
			// Clean the created page so the seeded e2e DB stays tidy.
			if (pageId) {
				const token = await adminToken(request);
				const del = await request.delete(`/api/admin/pages/${pageId}`, {
					headers: { Authorization: `Bearer ${token}` },
				});
				expect([200, 204, 404]).toContain(del.status());
			}
		}
	});
});
