/**
 * Scoped category/tag RSS feeds (DEC-074, TASK-146).
 *
 * A reader on a category/tag page gets a topic-scoped feed: the page emits an
 * <link rel="alternate" type="application/rss+xml"> autodiscovery tag plus a
 * visible subscribe button, and the feed URL returns only posts in that topic.
 *
 * Data is created through the admin API so the test is independent of seed
 * content: a fresh category, a post in it, and an unrelated post.
 */

import { expect, test } from "@playwright/test";

// Feed endpoints are served by the backend, not by the Nuxt server (which
// proxies only /api to it), so fetch feeds at the backend origin directly.
const BACKEND = process.env.NUXT_PROXY_TARGET || "http://localhost:18888";

let counter = 0;
function unique(prefix: string): string {
	counter += 1;
	return `${prefix}-${Date.now()}-${counter}`;
}

async function adminToken(request: import("@playwright/test").APIRequestContext) {
	const login = await request.post("/api/admin/login", {
		form: { username: "admin", password: "admin123" },
	});
	expect(login.status()).toBe(200);
	return (await login.json()).access_token as string;
}

async function createCategory(request: import("@playwright/test").APIRequestContext, name: string) {
	const token = await adminToken(request);
	const resp = await request.post("/api/categories", {
		data: { name, slug: unique("rss-cat") },
		headers: { Authorization: `Bearer ${token}` },
	});
	expect(resp.status()).toBe(201);
	return (await resp.json()).id as number;
}

async function createPost(
	request: import("@playwright/test").APIRequestContext,
	title: string,
	extra: Record<string, unknown> = {},
) {
	const token = await adminToken(request);
	const resp = await request.post("/api/posts", {
		data: {
			title,
			slug: unique("rss-scoped-post"),
			content: `content of ${title}`,
			excerpt: `excerpt of ${title}`,
			published: true,
			...extra,
		},
		headers: { Authorization: `Bearer ${token}` },
	});
	expect(resp.status()).toBe(201);
	return resp;
}

test.describe("Scoped category feed", () => {
	test("category page exposes a scoped feed that contains only that category", async ({
		page,
		request,
	}) => {
		const categoryName = unique("订阅分类");
		const catId = await createCategory(request, categoryName);
		const feedUrl = `/rss/feed.xml?category_id=${catId}`;
		const backendFeedUrl = `${BACKEND}${feedUrl}`;

		await createPost(request, "RSS 分类内文章", { category_id: catId });
		await createPost(request, "RSS 无关文章");

		// The feed itself filters to the category (fetch from the backend origin).
		const feed = await request.get(backendFeedUrl);
		expect(feed.status()).toBe(200);
		expect(feed.headers()["content-type"]).toContain("application/rss+xml");
		const body = await feed.text();
		expect(body).toContain("RSS 分类内文章");
		expect(body).not.toContain("RSS 无关文章");
		// Channel identifies the topic and self-links the scoped URL.
		expect(body).toContain(categoryName);
		expect(body).toContain(feedUrl);

		// The category page emits autodiscovery + a visible subscribe link.
		await page.goto(`/categories?category_id=${catId}`);
		const subscribe = page.locator(`a[href="${feedUrl}"]`);
		await expect(subscribe).toBeVisible();
		await expect(subscribe).toContainText("RSS 订阅");

		// The site globally advertises the unscoped feed (app.vue); on a topic
		// page the scoped feed must ALSO be advertised as an alternate link.
		const alternates = await page.evaluate(() =>
			Array.from(document.querySelectorAll('link[rel="alternate"][type="application/rss+xml"]')).map(
				(node) => node.getAttribute("href"),
			),
		);
		expect(alternates).toContain(feedUrl);
	});

	test("scoped Atom feed matches the RSS scope", async ({ request }) => {
		const catId = await createCategory(request, unique("Atom分类"));
		await createPost(request, "Atom 分类内文章", { category_id: catId });
		await createPost(request, "Atom 无关文章");

		const response = await request.get(`${BACKEND}/rss/atom.xml?category_id=${catId}`);
		expect(response.status()).toBe(200);
		const body = await response.text();
		expect(body).toContain("Atom 分类内文章");
		expect(body).not.toContain("Atom 无关文章");
	});

	test("unknown scope id returns 404 instead of the global feed", async ({ request }) => {
		const response = await request.get(`${BACKEND}/rss/feed.xml?category_id=99999999`);
		expect(response.status()).toBe(404);
	});
});
