/**
 * Author post-preview journey (DEC-150, TASK-187).
 *
 * An admin previews a not-yet-published (draft) post; the preview page renders
 * it as readers would see it. Guests (no admin session) are redirected to the
 * admin login.
 */

import { expect, test } from "@playwright/test";

const stamp = Date.now();

test.describe("Admin post preview (TASK-187)", () => {
	test("an admin previews a draft post, and a guest is redirected", async ({ page, request }) => {
		// Log in as admin and capture the token to create a draft.
		await page.goto("/admin/login");
		await page.fill('input[type="text"]', "admin");
		await page.fill('input[type="password"]', "admin123");
		await page.click('button[type="submit"]');
		await page.waitForURL("**/admin/posts");
		const token = (await page.evaluate(() => localStorage.getItem("admin_token"))) ?? "";
		const headers = { Authorization: `Bearer ${token}` };

		const slug = `draft-${stamp}`;
		const created = await request.post("/api/admin/posts", {
			data: {
				title: "Draft For Preview",
				slug,
				content: "# Preview Me\n\nThis is the draft body.",
				excerpt: "draft excerpt",
				published: false,
			},
			headers,
		});
		expect(created.status()).toBe(201);
		const postId = ((await created.json()) as { id: number }).id;

		// Preview from the admin post list.
		await page.goto("/admin/posts");
		const row = page.locator("tr", { hasText: "Draft For Preview" }).first();
		await row.getByRole("link").getByTitle("预览").click();
		await page.waitForURL(`**/preview/posts/${postId}`);

		await expect(page.locator("h1", { hasText: "Draft For Preview" })).toBeVisible({
			timeout: 10000,
		});
		await expect(page.locator("body")).toContainText("预览（尚未发布）");
		await expect(page.locator("body")).toContainText("This is the draft body.");

		// A logged-out visitor is redirected to admin login.
		await page.context().clearCookies();
		await page.addInitScript(() => localStorage.clear());
		await page.goto(`/preview/posts/${postId}`);
		await page.waitForURL("**/admin/login", { timeout: 10000 });
	});
});
