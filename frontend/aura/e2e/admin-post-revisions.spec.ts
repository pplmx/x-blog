/**
 * Admin post revision history UI (RIL TASK-191, DEC-158).
 *
 * An author opens an existing post's version history and restores an earlier
 * saved snapshot; the editor then reflects the restored content.
 */

import { expect, test } from "@playwright/test";

const stamp = Date.now();

test.describe("Admin post revision history (TASK-191)", () => {
	test("an author restores an earlier version and the editor reflects it", async ({
		page,
		request,
	}) => {
		// Log in and capture the token to seed a post with two saved revisions.
		await page.goto("/admin/login");
		await page.fill('input[type="text"]', "admin");
		await page.fill('input[type="password"]', "admin123");
		await page.click('button[type="submit"]');
		await page.waitForURL("**/admin/posts");
		const token = (await page.evaluate(() => localStorage.getItem("admin_token"))) ?? "";
		const headers = { Authorization: `Bearer ${token}` };

		const slug = `rev-e2e-${stamp}`;
		const created = await request.post("/api/admin/posts", {
			data: { title: "Revision E2E", slug, content: "V1 content", published: false },
			headers,
		});
		expect(created.ok()).toBe(true);
		const postId = ((await created.json()) as { id: number }).id;

		// Second revision: an edit saved via the backend.
		const updated = await request.put(`/api/admin/posts/${postId}`, {
			data: { content: "V2 content" },
			headers,
		});
		expect(updated.ok()).toBe(true);

		await page.goto(`/admin/posts/${postId}`);
		const contentTextarea = page.locator('textarea[placeholder*="Markdown"]');
		await expect(contentTextarea).toHaveValue("V2 content", { timeout: 10000 });

		// Open the version-history panel: the two saved revisions are listed.
		await page.locator('[data-testid="revision-toggle"]').click();
		await expect(page.locator('[data-testid="revision-row"]')).toHaveCount(2, { timeout: 10000 });

		// Restore the OLDEST (first-saved "V1") revision, newest-first order.
		const oldestRow = page.locator('[data-testid="revision-row"]').last();
		await oldestRow.getByRole("button", { name: /恢复此版本/ }).click();

		await expect(page.locator('[data-testid="revision-message"]')).toContainText("已恢复所选版本", {
			timeout: 10000,
		});
		await expect(contentTextarea).toHaveValue("V1 content", { timeout: 10000 });
	});
});
