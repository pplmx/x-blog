/**
 * Comment-activity analytics journey (DEC-154, TASK-189).
 *
 * An approved comment shows up in the admin dashboard's comment-activity card
 * (total + most-discussed posts), the engagement axis opposite consumption.
 */

import { expect, test } from "@playwright/test";

const stamp = Date.now();

test.describe("Admin comment activity (TASK-189)", () => {
	test("an approved comment appears in the dashboard comment activity", async ({
		page,
		request,
	}) => {
		// Log in as admin and capture the token to seed the post + approval.
		await page.goto("/admin/login");
		await page.fill('input[type="text"]', "admin");
		await page.fill('input[type="password"]', "admin123");
		await page.click('button[type="submit"]');
		await page.waitForURL("**/admin/posts");
		const token = (await page.evaluate(() => localStorage.getItem("admin_token"))) ?? "";
		const headers = { Authorization: `Bearer ${token}` };

		const slug = `discussed-${stamp}`;
		const created = await request.post("/api/admin/posts", {
			data: {
				title: `Discussion Magnet ${stamp}`,
				slug,
				content: "body",
				excerpt: "e2e",
				published: true,
			},
			headers,
		});
		expect(created.status()).toBe(201);
		const postId = ((await created.json()) as { id: number }).id;

		const comment = await request.post(`/api/comments/post/${postId}`, {
			data: { content: "great read", nickname: "E2E", email: "e2e@example.com" },
		});
		expect(comment.status()).toBe(201);
		const commentId = ((await comment.json()) as { id: number }).id;
		const approved = await request.patch(`/api/comments/${commentId}/approve`, {
			data: { approved: true },
			headers,
		});
		expect(approved.status()).toBe(200);

		await page.goto("/admin");
		const card = page.locator("div", { hasText: "评论活跃度" }).first();
		await expect(card).toBeVisible({ timeout: 10000 });
		await expect(card).toContainText(`Discussion Magnet ${stamp}`);
	});
});
