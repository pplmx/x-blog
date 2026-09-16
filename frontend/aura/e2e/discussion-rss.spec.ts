/**
 * Discussion RSS journey (round 368, DEC-409).
 *
 * The conversation is findable (comment search), browsable (/discussion) — the
 * feeds make it SUBSCRIBABLE: /rss/comments.xml streams the latest approved
 * comments as RSS 2.0 (Atom at /rss/comments.atom.xml), one item per comment
 * deep-linking ONTO the comment (#comment-{id}, DEC-321). The /discussion page
 * surfaces a Subscribe link + discovery tags so a feed reader finds it.
 */

import { expect, test } from "@playwright/test";

async function postAndApprove(
	request: import("@playwright/test").APIRequestContext,
	content: string,
): Promise<{ slug: string; commentId: number }> {
	const post = await request.get("/api/posts?limit=1");
	expect(post.status()).toBe(200);
	const { id: postId, slug } = (
		(await post.json()) as { items: Array<{ id: number; slug: string }> }
	).items[0];

	const created = await request.post(`/api/comments/post/${postId}`, {
		data: { nickname: "订阅侠", email: "rss@example.com", content },
	});
	expect(created.status()).toBe(201);
	const commentId = (await created.json()).id as number;

	const admin = await request.post("/api/admin/login", {
		form: { username: "admin", password: "admin123" },
	});
	const token = ((await admin.json()) as { access_token: string }).access_token;
	const approved = await request.patch(`/api/comments/${commentId}/approve`, {
		data: { approved: true },
		headers: { Authorization: `Bearer ${token}` },
	});
	expect(approved.status()).toBe(200);
	return { slug, commentId };
}

test.describe("Discussion RSS (DEC-409)", () => {
	test("RSS feed streams the newest approved comment with a deep link onto it", async ({
		request,
	}) => {
		const marker = `订阅流marker-${Date.now()}`;
		const { slug, commentId } = await postAndApprove(request, marker);

		const resp = await request.get("/rss/comments.xml");
		expect(resp.status()).toBe(200);
		expect(resp.headers()["content-type"] ?? "").toContain("application/rss+xml");
		const xml = await resp.text();
		// The newest comment appears in the stream…
		expect(xml).toContain(marker);
		expect(xml).toContain("订阅侠");
		// …and its item deep-links ONTO the comment (DEC-321).
		expect(xml).toContain(`#comment-${commentId}`);
		expect(xml).toContain(`/posts/${slug}#comment-${commentId}`);
	});

	test("the /discussion page advertises the feeds via subscribe link + discovery tags", async ({
		page,
		request,
	}) => {
		const marker = `订阅页marker-${Date.now()}`;
		await postAndApprove(request, marker);

		await page.goto("/discussion");
		const subscribe = page.getByRole("link", { name: "订阅讨论 RSS" });
		await expect(subscribe).toBeVisible();
		await expect(subscribe).toHaveAttribute("href", "/rss/comments.xml");

		// Auto-discovery link tags in <head> for feed readers.
		const head = await page.evaluate(() => document.head.innerHTML);
		expect(head).toContain("/rss/comments.xml");
		expect(head).toContain("/rss/comments.atom.xml");
	});
});
