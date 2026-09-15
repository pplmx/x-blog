/**
 * Slug-change redirects (round 350): a re-slugged post / series / static page
 * keeps its old URL alive.
 *
 * When an operator re-slugs an entity the backend answers the old URL with a
 * 404 (contract unchanged — the public surface is no-oracle) plus an
 * `X-Redirect-To` header naming the canonical target. SSR turns that into a
 * real 301 + Location through the Nuxt origin, so crawlers, link-shares and
 * stale in-app links all land on the new slug. This spec drives the full
 * journey once through a browser (post) and twice through the origin's HTTP
 * contract (page and series): re-slug -> old API URL 404s with the header ->
 * old page URL answers 301 -> the browser lands on the canonical URL.
 *
 * Uses the live backend seeded by the justfile `e2e` task + the Nuxt dev
 * server. Unique slugs per run so retries never collide.
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

test.describe("Slug-change redirects (round 350)", () => {
	test.skip(
		() => !!process.env.CI_RESTRICTED,
		"full journey requires an admin re-slug on the live backend",
	);

	test("re-slugged post: old URL 301s to the canonical slug end-to-end", async ({
		page,
		request,
	}) => {
		const uid = Date.now();
		const oldSlug = `old-presence-${uid}`;
		const newSlug = `canonical-${uid}`;
		const title = `Redirect Journey ${uid}`;

		// Seed a published post through the API, then re-slug it exactly as the
		// admin editor would (the capture happens in admin_update_post).
		const token = await adminToken(request);
		const adminH = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
		const created = await request.post("/api/admin/posts", {
			headers: adminH,
			data: { title, slug: oldSlug, content: "old slug content", published: true },
		});
		expect([200, 201]).toContain(created.status());
		const postId = ((await created.json()) as { id: number }).id;

		const reslug = await request.put(`/api/admin/posts/${postId}`, {
			headers: adminH,
			data: { slug: newSlug },
		});
		expect(reslug.status()).toBe(200);
		// The admin update answers with {id} (any field edits), so the new slug
		// is verified through the public surface below, not this body.
		expect(((await reslug.json()) as { id: number }).id).toBe(postId);

		// Backend contract through the origin proxy: the old API URL 404s but
		// carries the canonical target header.
		const oldApi = await request.get(`/api/posts/${oldSlug}`);
		expect(oldApi.status()).toBe(404);
		expect(oldApi.headers()["x-redirect-to"]).toBe(`/posts/${newSlug}`);

		// SSR turns it into a permanent redirect at the page route: 301 + the
		// canonical Location (maxRedirects 0 so the browser-less probe sees it).
		const oldPage = await request.get(`/posts/${oldSlug}`, { maxRedirects: 0 });
		expect(oldPage.status()).toBe(301);
		expect(oldPage.headers().location).toBe(`/posts/${newSlug}`);

		// A real browser follows the 301 and renders the canonical URL.
		await page.goto(`/posts/${oldSlug}`);
		await page.waitForURL(`**/posts/${newSlug}`);
		await expect(page.locator("h1")).toContainText(title, { timeout: 10000 });

		// The canonical URL serves directly for good measure.
		const freshPage = await request.get(`/posts/${newSlug}`);
		expect(freshPage.status()).toBe(200);
		expect(await freshPage.text()).toContain(title);
	});

	test("re-slugged page: /pages/{old} -> /pages/{new} through the origin", async ({ request }) => {
		const uid = Date.now();
		const oldSlug = `old-page-${uid}`;
		const newSlug = `canonical-page-${uid}`;

		const token = await adminToken(request);
		const adminH = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
		const created = await request.post("/api/admin/pages", {
			headers: adminH,
			data: { slug: oldSlug, title: "Redirect Page", content: "x", published: true },
		});
		expect(created.status()).toBe(201);
		const pageId = ((await created.json()) as { id: number }).id;

		const reslug = await request.patch(`/api/admin/pages/${pageId}`, {
			headers: adminH,
			data: { slug: newSlug },
		});
		expect(reslug.status()).toBe(200);

		const oldApi = await request.get(`/api/pages/${oldSlug}`);
		expect(oldApi.status()).toBe(404);
		expect(oldApi.headers()["x-redirect-to"]).toBe(`/pages/${newSlug}`);

		const oldPage = await request.get(`/pages/${oldSlug}`, { maxRedirects: 0 });
		expect(oldPage.status()).toBe(301);
		expect(oldPage.headers().location).toBe(`/pages/${newSlug}`);
	});

	test("re-slugged series: /series/{old} -> /series/{new} through the origin", async ({
		request,
	}) => {
		const uid = Date.now();
		const oldSlug = `old-series-${uid}`;
		const newSlug = `canonical-series-${uid}`;

		const token = await adminToken(request);
		const adminH = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
		const created = await request.post("/api/series", {
			headers: adminH,
			data: { title: "Redirect Series", slug: oldSlug, description: "x" },
		});
		expect(created.status()).toBe(201);
		const seriesId = ((await created.json()) as { id: number }).id;

		const reslug = await request.put(`/api/series/${seriesId}`, {
			headers: adminH,
			data: { slug: newSlug },
		});
		expect(reslug.status()).toBe(200);

		const oldApi = await request.get(`/api/series/${oldSlug}`);
		expect(oldApi.status()).toBe(404);
		expect(oldApi.headers()["x-redirect-to"]).toBe(`/series/${newSlug}`);

		const oldPage = await request.get(`/series/${oldSlug}`, { maxRedirects: 0 });
		expect(oldPage.status()).toBe(301);
		expect(oldPage.headers().location).toBe(`/series/${newSlug}`);
	});
});
