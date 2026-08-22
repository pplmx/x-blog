/**
 * Comment flag/report journey (DEC-108, TASK-166).
 *
 * A visitor can flag an inappropriate comment (one per browser via
 * localStorage; the backend dedups per source), and an admin's moderation
 * queue shows the flagged comment with a distinct-flag count.
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
		data: { nickname: "FlagTester", email: "flag@example.com", content },
	});
	expect(created.status()).toBe(201);
	const commentId = (await created.json()).id as number;

	const admin = await request.post("/api/admin/login", {
		form: { username: "admin", password: "admin123" },
	});
	const token = (await admin.json()).access_token as string;
	await request.patch(`/api/comments/${commentId}/approve`, {
		data: { approved: true },
		headers: { Authorization: `Bearer ${token}` },
	});
	return commentId;
}

test.describe("Comment flagging (DEC-108)", () => {
	test("a visitor flags a comment and it appears in the admin queue", async ({ page, request }) => {
		const post = await firstPost(request);
		const stamp = Date.now();
		const commentId = await postAndApprove(request, post.id, `flag me ${stamp}`);

		// Visitor flags the comment on the post page.
		await page.goto(`/posts/${post.slug}`);
		const flag = page.locator(`#comment-${commentId} .comment-flag`);
		await expect(flag).toBeVisible({ timeout: 10000 });
		await flag.click();
		await expect(flag).toContainText("已举报", { timeout: 10000 });
		// Re-click is a no-op (localStorage dedup).
		await flag.click();
		await expect(flag).toContainText("已举报");

		// The flag surfaced in the admin queue with a distinct-flag count.
		const admin = await request.post("/api/admin/login", {
			form: { username: "admin", password: "admin123" },
		});
		const token = (await admin.json()).access_token as string;
		const queue = await request.get("/api/admin/comments?flagged=true", {
			headers: { Authorization: `Bearer ${token}` },
		});
		expect(queue.status()).toBe(200);
		const items = ((await queue.json()) as { items: Array<{ id: number; flag_count: number }> })
			.items;
		const flagged = items.find((c) => c.id === commentId);
		expect(flagged).toBeDefined();
		expect(flagged?.flag_count ?? 0).toBeGreaterThanOrEqual(1);
	});
});
