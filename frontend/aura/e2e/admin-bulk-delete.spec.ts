/**
 * Admin bulk-comment delete journey (DEC-110, TASK-167).
 *
 * An admin selects a pending comment in the moderation queue and deletes it in
 * one batch action (with confirmation), seeing the deleted-count feedback.
 */

import { expect, test } from "@playwright/test";

async function firstPost(
	request: import("@playwright/test").APIRequestContext,
): Promise<{ id: number; slug: string }> {
	const resp = await request.get("/api/posts?limit=1");
	expect(resp.status()).toBe(200);
	return ((await resp.json()) as { items: Array<{ id: number; slug: string }> }).items[0];
}

test.describe("Admin bulk-comment delete (DEC-110)", () => {
	test("admin deletes a selected pending comment via batch action", async ({ page, request }) => {
		const post = await firstPost(request);
		const stamp = Date.now();
		const content = `bulk delete me ${stamp}`;
		const created = await request.post(`/api/comments/post/${post.id}`, {
			data: { nickname: "BulkTester", email: "bulk@example.com", content },
		});
		expect(created.status()).toBe(201);

		// Login as admin and open the moderation queue.
		await page.goto("/admin/login");
		await page.fill('input[type="text"]', "admin");
		await page.fill('input[type="password"]', "admin123");
		await page.click('button[type="submit"]');
		await page.waitForURL("**/admin/posts");
		await page.goto("/admin/comments");

		// Find the pending comment card and check its checkbox.
		const card = page.locator(".bg-white.dark\\:bg-gray-900", { hasText: content }).first();
		await expect(card).toBeVisible({ timeout: 10000 });
		await card.locator('input[type="checkbox"]').check();

		// Bulk delete with confirmation.
		page.once("dialog", (d) => d.accept());
		await page.locator("button", { hasText: "删除所选" }).click();

		// Deleted-count feedback appears and the comment is gone from the queue.
		await expect(page.locator("text=已删除 1 条评论")).toBeVisible({ timeout: 10000 });
		await expect(page.getByText(content)).toHaveCount(0, { timeout: 10000 });
	});
});
