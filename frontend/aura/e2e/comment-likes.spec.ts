/**
 * Comment likes journey (DEC-092, TASK-158).
 *
 * An approved comment renders a like button with its count; a visitor can like
 * it once (localStorage dedup — a second click is a no-op), and the count
 * updates from the API response. The comment is seeded via the API and
 * approved as admin so it appears on the public post page.
 */

import { expect, test } from "@playwright/test";

async function firstPost(
	request: import("@playwright/test").APIRequestContext,
): Promise<{ id: number; slug: string }> {
	const resp = await request.get("/api/posts?limit=1");
	expect(resp.status()).toBe(200);
	return ((await resp.json()) as { items: Array<{ id: number; slug: string }> }).items[0];
}

async function postAndApprove(
	request: import("@playwright/test").APIRequestContext,
	postId: number,
	content: string,
): Promise<number> {
	const created = await request.post(`/api/comments/post/${postId}`, {
		data: { nickname: "LikeTester", email: "like@example.com", content },
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
	return commentId;
}

test.describe("Comment likes (DEC-092)", () => {
	test("a visitor likes an approved comment once; clicks are deduped", async ({
		page,
		request,
	}) => {
		const post = await firstPost(request);
		// Unique content keeps the anchor unambiguous even with past runs' seed.
		const commentId = await postAndApprove(request, post.id, `likable snippet ${Date.now()}`);

		await page.goto(`/posts/${post.slug}#comment-${commentId}`);
		const like = page.locator(`#comment-${commentId} .comment-like`);
		await expect(like).toBeVisible({ timeout: 10000 });
		await expect(like.locator(".like-count")).toHaveText("0");

		await like.click();
		await expect(like.locator(".like-count")).toHaveText("1");
		await expect(like).toHaveAttribute("aria-pressed", "true");

		// Dedup: the second click is a no-op (localStorage guard).
		await like.click();
		await expect(like.locator(".like-count")).toHaveText("1");
	});
});
