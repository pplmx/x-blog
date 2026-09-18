/**
 * Home "Trending this week" (round 387, DEC-438).
 *
 * The home page has an all-time Popular row and, since this round, a
 * time-windowed "Trending this week" row ranked by in-window views from the
 * backend's post_views_daily analytics table (upserted on every pageview,
 * DEC-086). Journey: publish a fresh post, give it a decisive same-day view
 * count via POST /api/posts/{id}/view, land on the home page and confirm the
 * post surfaces inside the Trending section with the weekly-reads caption.
 * Uses the live backend seeded by `just e2e` + the Nuxt preview server.
 */

import { type APIRequestContext, expect, type Page, test } from "@playwright/test";

async function adminToken(request: APIRequestContext): Promise<string> {
	const login = await request.post("/api/admin/login", {
		form: { username: "admin", password: "admin123" },
	});
	expect(login.status()).toBe(200);
	return (await login.json()).access_token as string;
}

/** The trending section container: the div whose child is the section heading. */
function trendingSection(page: Page) {
	return page.getByRole("heading", { name: "本周热门" }).locator("..");
}

test.describe("Home trending this week (DEC-438)", () => {
	test.skip(() => !!process.env.CI_RESTRICTED, "full journey requires admin publish");

	test("a freshly published and viewed post appears in the trending row", async ({
		page,
		request,
	}) => {
		const adminH = { Authorization: `Bearer ${await adminToken(request)}` };

		// Prior runs leave published same-day-view posts in the shared dev DB:
		// init_db is idempotent and never clears post_views_daily, so accumulated
		// runs would rank on top of the fresh post and push it out of the top-4
		// slice the home page renders (CI uses a fresh Postgres container, but a
		// local `just e2e` re-run would flake). Clean up by slug prefix first —
		// the public list is newest-first, and leftover posts are the newest.
		const list = await request.get("/api/posts", { params: { limit: 100 } });
		const prior = ((await list.json()) as { items: { id: number; slug: string }[] }).items;
		for (const p of prior.filter((p) => p.slug.startsWith("trending-burst-"))) {
			await request.delete(`/api/posts/${p.id}`, { headers: adminH });
		}

		const uid = Date.now();
		const title = `Trending burst ${uid}`;
		const slug = `trending-burst-${uid}`;

		const post = await request.post("/api/posts", {
			headers: adminH,
			data: { title, slug, content: "# Burst", published: true },
		});
		expect(post.status()).toBe(201);
		const postId = ((await post.json()) as { id: number }).id;

		// Give it a decisive in-window (today) view count — far above the seeded
		// weekly ranking (next-best is single digits), and equal-count fresh
		// posts break by id desc, so this newest post ranks first among them.
		// Deterministic top-4 (the home slice) membership: only the two seeded
		// all-time leaders exceed 30 weekly views.
		for (let i = 0; i < 30; i++) {
			const v = await request.post(`/api/posts/${postId}/view`);
			expect(v.status()).toBe(200);
		}

		await page.goto("/");
		const section = trendingSection(page);
		await expect(section).toBeVisible({ timeout: 10000 });
		// The post's card is inside the trending grid (the link's accessible
		// name carries the rank + title + weekly caption together).
		const postCard = section.getByRole("link", { name: new RegExp(title) });
		await expect(postCard).toBeVisible({ timeout: 10000 });
		await expect(postCard.getByText(/次阅读/)).toBeVisible();
	});
});
