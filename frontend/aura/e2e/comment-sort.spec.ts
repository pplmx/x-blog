/**
 * Comment sorting journey (DEC-094, TASK-159).
 *
 * An approved comment thread exposes a sort dropdown (Newest / Oldest / Most
 * helpful). Switching to "Most helpful" reorders the thread so the comment
 * with the most likes renders first. Comments are seeded and liked via the API
 * so the counts are deterministic.
 */

import { expect, test } from "@playwright/test";

async function firstPost(
	request: import("@playwright/test").APIRequestContext,
): Promise<{ id: number; slug: string }> {
	const resp = await request.get("/api/posts?limit=1");
	expect(resp.status()).toBe(200);
	return ((await resp.json()) as { items: Array<{ id: number; slug: string }> }).items[0];
}

/** Post a comment and approve it as admin; returns the comment id. */
async function postAndApprove(
	request: import("@playwright/test").APIRequestContext,
	postId: number,
	content: string,
): Promise<number> {
	const created = await request.post(`/api/comments/post/${postId}`, {
		data: { nickname: "SortTester", email: "sort@example.com", content },
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

/** Like a comment `times` times via the API (backend allows repeats; the frontend dedups). */
async function likeTimes(
	request: import("@playwright/test").APIRequestContext,
	commentId: number,
	times: number,
): Promise<void> {
	for (let i = 0; i < times; i++) {
		const resp = await request.post(`/api/comments/${commentId}/like`);
		expect(resp.status()).toBe(200);
	}
}

test.describe("Comment sorting (DEC-094)", () => {
	test("Most helpful reorders the thread by like count", async ({ page, request }) => {
		const post = await firstPost(request);
		const stamp = Date.now();

		const low = await postAndApprove(request, post.id, `sort low ${stamp}`);
		const high = await postAndApprove(request, post.id, `sort high ${stamp}`);
		const mid = await postAndApprove(request, post.id, `sort mid ${stamp}`);
		await likeTimes(request, high, 5);
		await likeTimes(request, mid, 3);
		await likeTimes(request, low, 1);

		await page.goto(`/posts/${post.slug}`);
		const sortSelect = page.locator("#comment-sort");
		await expect(sortSelect).toBeVisible({ timeout: 10000 });

		await sortSelect.selectOption("likes");
		await expect(page.getByText(`sort high ${stamp}`)).toBeVisible({ timeout: 10000 });

		// Under "Most helpful" the highest-liked comment owns the first row.
		const firstRow = page.locator(".space-y-4 > li").first();
		await expect(firstRow).toContainText(`sort high ${stamp}`);
		await expect(firstRow).not.toContainText(`sort low ${stamp}`);
	});
});
