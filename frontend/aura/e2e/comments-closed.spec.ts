/**
 * Per-post comment control (round 351): closing the door on one post's
 * comments without deleting the conversation or disabling the whole site.
 *
 * Operator closes comments in the editor -> readers see a "comments closed"
 * notice instead of the form, the API refuses new comments (403), and the
 * public page still lists the existing thread. Uses the live backend seeded
 * by the justfile `e2e` task + the Nuxt dev server; the seeded post is
 * cleaned up at the end.
 */

import { type APIRequestContext, expect, test } from "@playwright/test";

const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "admin123";

async function adminToken(request: APIRequestContext): Promise<string> {
	const res = await request.post("/api/admin/login", {
		form: { username: ADMIN_USERNAME, password: ADMIN_PASSWORD },
	});
	expect(res.status()).toBe(200);
	return ((await res.json()) as { access_token: string }).access_token;
}

test.describe("Per-post comment control (round 351)", () => {
	test.skip(
		() => !!process.env.CI_RESTRICTED,
		"full journey requires an admin editor save on the live backend",
	);

	test("close comments in the editor -> public notice + refused POST + thread intact", async ({
		page,
		request,
	}) => {
		const uid = Date.now();
		const slug = `closed-comments-${uid}`;
		const title = `Comments Closed ${uid}`;

		// Seed a published, comments-open post with one approved comment so the
		// "existing thread stays visible" guarantee has something to assert on.
		const token = await adminToken(request);
		const adminH = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
		const created = await request.post("/api/admin/posts", {
			headers: adminH,
			data: { title, slug, content: "# Closed\n\nthread stays", published: true },
		});
		expect([200, 201]).toContain(created.status());
		const postId = ((await created.json()) as { id: number }).id;

		try {
			const guestComment = await request.post(`/api/comments/post/${postId}`, {
				data: { nickname: "Guest", email: "guest@example.com", content: "the old thread" },
			});
			expect([200, 201]).toContain(guestComment.status());
			const cid = ((await guestComment.json()) as { id: number }).id;
			const approved = await request.patch(`/api/comments/${cid}/approve`, {
				headers: adminH,
				data: { approved: true },
			});
			expect(approved.status()).toBe(200);

			// Operator closes the comments in the editor (UI, not API).
			await page.goto("/admin/login", { timeout: 20000 });
			await page.fill('input[type="text"]', ADMIN_USERNAME);
			await page.fill('input[type="password"]', ADMIN_PASSWORD);
			await page.click('button[type="submit"]');
			await page.waitForURL("**/admin/posts", { timeout: 20000 });

			await page.goto(`/admin/posts/${postId}`);
			const toggle = page.locator("#comments-enabled");
			await expect(toggle).toBeVisible({ timeout: 10000 });
			await expect(toggle).toBeChecked();
			await toggle.uncheck();
			await page.locator('button[type="submit"]').first().click();
			await expect(page.locator('[data-testid="save-success"]')).toBeVisible({
				timeout: 10000,
			});

			// Readers see the notice instead of the form…
			await page.goto(`/posts/${slug}`);
			// .first(): the seed content also contributes a markdown h1 (# Closed).
			await expect(page.locator("h1").first()).toContainText(title, { timeout: 10000 });
			await expect(page.locator("body")).toContainText("这篇文章的评论已关闭。", {
				timeout: 10000,
			});
			await expect(page.locator("textarea[role='combobox']")).toHaveCount(0);
			// …and the existing conversation is still readable.
			await expect(page.getByText("the old thread")).toBeVisible();

			// The API refuses new comments on a closed post (second line of
			// defense; 403 keeps "cannot write" distinct from a 404 unknown).
			const refused = await request.post(`/api/comments/post/${postId}`, {
				data: { nickname: "Guest", email: "guest@example.com", content: "nope" },
			});
			expect(refused.status()).toBe(403);

			// The admin detail still reflects the closed state on reload.
			const detail = await request.get(`/api/admin/posts/${postId}`, { headers: adminH });
			expect(detail.status()).toBe(200);
			expect(((await detail.json()) as { comments_enabled: boolean }).comments_enabled).toBe(false);
		} finally {
			await request.delete(`/api/admin/posts/${postId}`, { headers: adminH });
		}
	});
});
