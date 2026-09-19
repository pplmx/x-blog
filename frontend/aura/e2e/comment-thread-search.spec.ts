/**
 * Search inside a comment thread journey (round 389, DEC-442).
 *
 * A long discussion has no "find X in this thread" surface — the global
 * comment search cannot scope to a post. The thread list now accepts a `q`
 * that narrows to matching approved comments. This spec seeds a post with
 * several approved comments (one carrying a unique marker), opens the post,
 * types the marker into the thread search box, and verifies the list narrows
 * to the matching row and then — after clearing — restores the full thread.
 */

import { expect, test } from "@playwright/test";

test("searches inside a comment thread and restores it on clear", async ({ page, request }) => {
	// Seed a unique post with three approved comments, two matching a marker.
	const marker = `threadsearch-${Date.now()}`;
	const title = `Thread search ${Date.now()}`;
	const slug = `thread-search-${Date.now()}`;

	const adminLogin = await request.post("/api/admin/login", {
		form: { username: "admin", password: "admin123" },
	});
	expect(adminLogin.status()).toBe(200);
	const adminH = {
		Authorization: `Bearer ${(await adminLogin.json()).access_token}`,
	};

	const createdPost = await request.post("/api/posts", {
		data: { title, slug, content: "# Thread search", published: true },
		headers: adminH,
	});
	expect(createdPost.status()).toBe(201);
	const postId = (await createdPost.json()).id;

	const bodies = [
		`${marker} is the answer`,
		"An unrelated tangent",
		`${marker} again in another comment`,
	];
	const commentIds: number[] = [];
	for (const content of bodies) {
		const c = await request.post(`/api/comments/post/${postId}`, {
			data: { nickname: "旅人", email: "t@example.com", content },
		});
		expect(c.status()).toBe(201);
		commentIds.push((await c.json()).id);
	}
	for (const cid of commentIds) {
		const ok = await request.patch(`/api/comments/${cid}/approve`, {
			data: { approved: true },
			headers: adminH,
		});
		expect(ok.status()).toBe(200);
	}

	await page.goto(`/posts/${slug}`);

	// The full thread shows all three comments.
	await expect(page.getByText("An unrelated tangent")).toBeVisible();

	// Type the marker into the thread search box; the list narrows server-side.
	const searchBox = page.getByRole("searchbox", { name: "在本线程内搜索评论" });
	await searchBox.fill(marker);
	await expect(page.getByText(`${marker} is the answer`)).toBeVisible();
	await expect(page.getByText(`${marker} again in another comment`)).toBeVisible();
	// The unrelated comment is filtered out of the list.
	await expect(page.getByText("An unrelated tangent")).not.toBeVisible();

	// Clearing the box restores the full thread.
	const clear = page.getByRole("button", { name: "清除搜索" });
	await clear.click();
	await expect(page.getByText("An unrelated tangent")).toBeVisible();

	// Cleanup so repeated runs stay idempotent.
	await request.delete(`/api/posts/${postId}`, { headers: adminH });
});
