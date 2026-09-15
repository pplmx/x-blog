/**
 * Author byline + archive journey (DEC-359, TASK-405).
 *
 * The multi-editor author attribution slice end to end: a superuser gives the
 * writing admin a public pen name, a fresh post publishes, and that byline
 * surfaces on the post card and the post page — both linking to /authors/{id}
 * — and the archive page lists exactly that writer's published posts, titled
 * by pen name (never the login username: admin login is no-oracle).
 *
 * Uses the live backend seeded by the justfile `e2e` task + the Nuxt dev
 * server. The seeded DB may already hold posts from earlier runs; the journey
 * keys on the unique pen name + unique post title/slug this spec creates.
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

type AdminUser = { id: number; username: string; display_name?: string | null };

async function fetchUsers(request: APIRequestContext, token: string): Promise<AdminUser[]> {
	const res = await request.get("/api/admin/users", {
		headers: { Authorization: `Bearer ${token}` },
	});
	expect(res.status()).toBe(200);
	return (await res.json()) as AdminUser[];
}

test.describe("Author byline + archive (DEC-359)", () => {
	test.skip(
		() => !!process.env.CI_RESTRICTED,
		"full journey requires an admin publish on the live backend",
	);

	test("pen name -> card & post bylines -> author archive", async ({ page, request }) => {
		const uid = Date.now();
		const penName = `Byline Writer ${uid}`;
		const title = `Author byline post ${uid}`;
		const slug = `author-byline-e2e-${uid}`;

		// Superuser sets the writing admin's public pen name (the feature has
		// no public surface until a pen name exists — the username must stay
		// private, admin login is no-oracle).
		const token = await adminToken(request);
		const adminH = { Authorization: `Bearer ${token}` };
		const [admin] = (await fetchUsers(request, token)).filter((u) => u.username === ADMIN_USERNAME);
		expect(admin).toBeDefined();
		const patch = await request.patch(`/api/admin/users/${admin.id}`, {
			headers: { "Content-Type": "application/json", ...adminH },
			data: { display_name: penName },
		});
		expect(patch.status()).toBe(200);

		// Publish a fresh post authored by the writing admin (defaults to the
		// authenticated admin).
		const post = await request.post("/api/admin/posts", {
			headers: { "Content-Type": "application/json", ...adminH },
			data: {
				title,
				slug,
				content: "# Hello byline",
				published: true,
			},
		});
		expect(post.status()).toBe(201);
		const { id: postId } = (await post.json()) as { id: number };
		const adminHRef = { Authorization: `Bearer ${token}` };

		try {
			// --- Home page: the card carries a byline chip linking to the
			// writer's archive. Scroll the feed so the newest post renders.
			await page.goto("/");
			const cardByline = page
				.locator(`article:has-text("${title}") a[href="/authors/${admin.id}"]`)
				.first();
			await expect(cardByline).toBeVisible({ timeout: 10000 });
			await expect(cardByline).toContainText(penName);

			// --- Post page: the byline sits in the header meta, same link.
			await page.goto(`/posts/${slug}`);
			const postByline = page.locator(`header a[href="/authors/${admin.id}"]`).first();
			await expect(postByline).toBeVisible({ timeout: 10000 });
			await expect(postByline).toContainText(penName);

			// --- Author archive: titled by pen name, listing the fresh post;
			// the byline on the card inside it links back to the same archive.
			await page.goto(`/authors/${admin.id}`);
			await expect(page.locator("h1")).toContainText(penName, { timeout: 10000 });
			const archiveCard = page.locator(`article:has-text("${title}")`).first();
			await expect(archiveCard).toBeVisible();
			await expect(archiveCard.locator(`a[href="/authors/${admin.id}"]`)).toContainText(penName);

			// --- Scoped RSS feed (round 345): the archive links the writer's
			// own feed, and that feed actually carries the fresh post (a
			// genuinely scoped subscription surface, still no username).
			const feedLink = page.locator(`a[href="/rss/authors/${admin.id}.xml"]`);
			await expect(feedLink).toBeVisible();
			const feed = await request.get(`/rss/authors/${admin.id}.xml`);
			expect(feed.status()).toBe(200);
			const feedBody = await feed.text();
			expect(feedBody).toContain(title);
			expect(feedBody).toContain(penName);
			expect(feedBody).not.toContain(ADMIN_USERNAME);

			// --- No-oracle gate: the login username must never appear on the
			// public archive.
			await expect(page.locator("body")).not.toContainText(ADMIN_USERNAME);

			// --- Writers index (round 346): /authors lists the pen-named writer
			// with a published-count card linking back to this archive, so a
			// reader who found one byline can browse every contributor.
			await page.goto("/authors");
			const indexCard = page.locator(`a[href="/authors/${admin.id}"]`).first();
			await expect(indexCard).toContainText(penName, { timeout: 10000 });
			await expect(indexCard).toContainText("1");
			await expect(page.locator("body")).not.toContainText(ADMIN_USERNAME);
		} finally {
			// Clean the created post so the seeded e2e DB stays tidy.
			const del = await request.delete(`/api/admin/posts/${postId}`, {
				headers: adminHRef,
			});
			expect([200, 204, 404]).toContain(del.status());
			// Restore the admin to no public identity (empty pen name) — the
			// seeded admin starts anonymous; other journeys don't expect one.
			await request.patch(`/api/admin/users/${admin.id}`, {
				headers: { "Content-Type": "application/json", ...adminH },
				data: { display_name: null },
			});
		}
	});
});
