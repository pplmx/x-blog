/**
 * Admin "duplicate post" (round 349).
 *
 * An editor seeds a sibling draft from a template post: from the posts list,
 * the duplicate button clones the row into a new draft (same content/taxonomy,
 * fresh slug, publication metadata cleared) and lands straight in the new
 * draft's editor. The source post and the copy are cleaned up at the end.
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

test.describe("Admin post duplicate (round 349)", () => {
	test.skip(
		() => !!process.env.CI_RESTRICTED,
		"full journey requires an admin publish on the live backend",
	);

	test("duplicate -> a fresh draft opens in the editor", async ({ page, request }) => {
		const uid = Date.now();
		const title = `Template Post ${uid}`;
		const slug = `template-post-${uid}`;

		// Seed a source post through the API (published, so the copy clearly
		// becomes a draft).
		const token = await adminToken(request);
		const adminH = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
		const created = await request.post("/api/admin/posts", {
			headers: adminH,
			data: { title, slug, content: "# Body\n\ntemplate content", published: true },
		});
		expect([200, 201]).toContain(created.status());
		const sourceId = ((await created.json()) as { id: number }).id;

		let cloneId = 0;
		try {
			// Login through the admin UI (generous timeout: the sandbox's first
			// post-build admin nav has a known slow-load habit).
			await page.goto("/admin/login", { timeout: 20000 });
			await page.fill('input[type="text"]', ADMIN_USERNAME);
			await page.fill('input[type="password"]', ADMIN_PASSWORD);
			await page.click('button[type="submit"]');
			await page.waitForURL("**/admin/posts", { timeout: 20000 });

			// The source row's duplicate button — its own action column.
			await page.goto("/admin/posts");
			const row = page.locator(`tbody tr:has-text("${title}")`).first();
			await expect(row).toBeVisible({ timeout: 10000 });
			const duplicateBtn = row.locator('button[aria-label*="复制"]').first();
			await duplicateBtn.click();

			// Lands in the fresh draft's editor.
			await page.waitForURL(/\/admin\/posts\/\d+/);
			const cloneUrl = new URL(page.url());
			cloneId = Number.parseInt(String(cloneUrl.pathname.split("/").pop()), 10);
			expect(cloneId).not.toBe(sourceId);

			// Same title carried over (the editor pre-fills it).
			const titleInput = page.locator('input[placeholder="输入文章标题"]').first();
			await expect(titleInput).toHaveValue(title, { timeout: 10000 });

			// The copy is an unpublished draft via the API.
			const clone = await request.get(`/api/admin/posts/${cloneId}`, {
				headers: { Authorization: `Bearer ${token}` },
			});
			expect(clone.status()).toBe(200);
			const data = (await clone.json()) as { published: boolean; slug: string };
			expect(data.published).toBe(false);
			expect(data.slug).toContain("-copy");
		} finally {
			const token = await adminToken(request);
			const h = { Authorization: `Bearer ${token}` };
			for (const id of [cloneId, sourceId].filter(Boolean)) {
				const del = await request.delete(`/api/admin/posts/${id}`, { headers: h });
				expect([200, 204, 404]).toContain(del.status());
			}
		}
	});
});
