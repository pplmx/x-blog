/**
 * Combined search journey (?type=all) — series / static pages / author archives.
 *
 * /search used to index only posts (and comments, in ?type=comments); a term
 * that lived only in a series title, a static page body, or an author pen name
 * was a dead end. The All mode (?type=all) searches posts + series + published
 * static pages + author archives at once, each hit carrying a type tag and a
 * deep-linkable path. This spec seeds one uniquely-marked series, one published
 * page, and one pen-named author, then — opening the All-mode URL directly —
 * confirms each surface's hit deep-links to its real page.
 *
 * Uses the live backend seeded by the justfile `e2e` task; markers carry a
 * per-run uid so retries never collide with leftover data.
 */

import { type APIRequestContext, expect, test } from "@playwright/test";

const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "admin123";

async function adminToken(request: APIRequestContext): Promise<string> {
	const res = await request.post("/api/admin/login", {
		form: { username: ADMIN_USERNAME, password: ADMIN_PASSWORD },
	});
	expect(res.status()).toBe(200);
	// Boundary cast to the login response shape (same contract the other e2e
	// specs use for this endpoint); read the field off the named constant.
	const body = (await res.json()) as { access_token: string };
	return body.access_token;
}

async function adminUser(request: APIRequestContext, token: string): Promise<number> {
	const res = await request.get("/api/admin/users", {
		headers: { Authorization: `Bearer ${token}` },
	});
	expect(res.status()).toBe(200);
	// Boundary cast to the admin-user-list shape (matches author-byline.spec).
	const users = (await res.json()) as Array<{ id: number; username: string }>;
	const admin = users.find((u) => u.username === ADMIN_USERNAME);
	if (!admin) {
		throw new Error(`admin user '${ADMIN_USERNAME}' not found`);
	}
	return admin.id;
}

test.describe("Combined search — series / pages / authors (?type=all)", () => {
	test.skip(
		() => !!process.env.CI_RESTRICTED,
		"full journey requires admin writes on the live backend",
	);

	test("a term only in a series title deep-links to /series/{slug}", async ({ page, request }) => {
		const uid = Date.now();
		const token = await adminToken(request);
		const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
		const slug = `series-only-${uid}`;
		const marker = `seriesonlymarker-${uid}`;
		const title = `Unique Series ${uid}`;

		const created = await request.post("/api/series", {
			headers,
			data: { slug, title, description: `a journal about ${marker}` },
		});
		expect(created.status()).toBe(201);

		await page.goto(`/search?q=${encodeURIComponent(marker)}&type=all`);
		const card = page.locator(`a[href="/series/${slug}"]`).first();
		await expect(card).toBeVisible({ timeout: 10000 });
		await expect(card).toContainText(title);
		// The type tag renders so the mixed list scans by kind.
		await expect(page.locator("text=系列").first()).toBeVisible();

		await card.click();
		await page.waitForURL(`**/series/${slug}`);
		await expect(page.locator("h1")).toContainText(title, { timeout: 10000 });
	});

	test("a term only in a published page body deep-links to /pages/{slug}", async ({
		page,
		request,
	}) => {
		const uid = Date.now();
		const token = await adminToken(request);
		const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
		const slug = `page-only-${uid}`;
		const marker = `pageonlymarker-${uid}`;
		const title = `Unique Page ${uid}`;

		const created = await request.post("/api/admin/pages", {
			headers,
			data: { slug, title, content: `we care deeply about ${marker}`, published: true },
		});
		expect(created.status()).toBe(201);

		await page.goto(`/search?q=${encodeURIComponent(marker)}&type=all`);
		// `.first()`: a published page also appears in the site footer's page
		// link list, so the /pages/{slug} href can match both the search card
		// and the footer — either deep-links to the same page, so take the first.
		const card = page.locator(`a[href="/pages/${slug}"]`).first();
		await expect(card).toBeVisible({ timeout: 10000 });
		await expect(card).toContainText(title);
		await expect(page.locator("text=页面").first()).toBeVisible();

		await card.click();
		await page.waitForURL(`**/pages/${slug}`);
		await expect(page.locator("h1")).toContainText(title, { timeout: 10000 });
	});

	test("a term only in an author pen name deep-links to /authors/{id}", async ({
		page,
		request,
	}) => {
		const uid = Date.now();
		const token = await adminToken(request);
		const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
		// Keep the pen name short: User.display_name is a 50-char column, and a
		// long name would 422 the patch. The marker is a substring so searching
		// it finds the author by pen name.
		const penName = `Author ${uid}`;
		const marker = `authoronly-${uid}`;
		const adminId = await adminUser(request, token);

		const patched = await request.patch(`/api/admin/users/${adminId}`, {
			headers,
			data: { display_name: `${penName} ${marker}` },
		});
		expect(patched.status()).toBe(200);

		await page.goto(`/search?q=${encodeURIComponent(marker)}&type=all`);
		const card = page.locator(`a[href="/authors/${adminId}"]`).first();
		await expect(card).toBeVisible({ timeout: 10000 });
		await expect(card).toContainText(penName);
		await expect(page.locator("text=作者").first()).toBeVisible();

		await card.click();
		await page.waitForURL(`**/authors/${adminId}`);
		await expect(page.locator("h1")).toContainText(penName, { timeout: 10000 });
	});
});
