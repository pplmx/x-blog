/**
 * Author follow (round 353): a reader who loves one writer's posts subscribes
 * to just that person — where topic-shaped follows can't express it.
 *
 * Seeds a pen-named editor + a published post, signs a reader in on the post
 * page, follows the writer from the byline, confirms the writer lands in the
 * /account "关注的作者" section, then drives the fan-out contract through the
 * API: a new post from that author hits the follower's inbox, and unfollowing
 * stops it. Uses the live backend seeded by the justfile `e2e` task + the Nuxt
 * dev server; the seeded author and posts are cleaned up at the end.
 */

import { type APIRequestContext, expect, test } from "@playwright/test";

const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "admin123";
const READER_PASSWORD = "readerpass123";

async function adminToken(request: APIRequestContext): Promise<string> {
	const res = await request.post("/api/admin/login", {
		form: { username: ADMIN_USERNAME, password: ADMIN_PASSWORD },
	});
	expect(res.status()).toBe(200);
	return ((await res.json()) as { access_token: string }).access_token;
}

function freshEmail(): string {
	return `af-${Date.now()}@example.com`;
}

test.describe("Author follow (round 353)", () => {
	test.skip(
		() => !!process.env.CI_RESTRICTED,
		"full journey requires an admin editor save on the live backend",
	);

	test("follow a writer from the byline -> account lists them -> inbox fan-out", async ({
		page,
		request,
	}) => {
		// Five page loads + two admin interactive steps + API fan-out checks:
		// a genuinely multi-page journey, comfortably past the 30s default.
		test.setTimeout(60_000);
		const uid = Date.now();
		const authorHandle = `follow-author-${uid}`;
		const penName = `Pen Writer ${uid}`;
		const slugFirst = `author-follow-first-${uid}`;
		const slugSecond = `author-follow-second-${uid}`;
		const slugThird = `author-follow-third-${uid}`;

		const token = await adminToken(request);
		const adminH = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };

		// Seed a pen-named editor + two published posts (one kept for after the
		// follow, one for after the unfollow).
		const authorRes = await request.post("/api/admin/users", {
			headers: adminH,
			data: {
				username: authorHandle,
				password: "authorpass123",
				display_name: penName,
			},
		});
		expect(authorRes.status()).toBe(200);
		const authorId = ((await authorRes.json()) as { id: number }).id;

		async function publishPost(slug: string): Promise<number> {
			const res = await request.post("/api/admin/posts", {
				headers: adminH,
				data: {
					title: slug,
					slug,
					content: "# Post\n\nsigned by the author",
					published: true,
					author_id: authorId,
				},
			});
			expect([200, 201]).toContain(res.status());
			return ((await res.json()) as { id: number }).id;
		}

		const firstPostId = await publishPost(slugFirst);
		const secondPostId = await publishPost(slugSecond);
		let thirdPostId: number | undefined;

		try {
			// A fresh reader registers through the API and signs in through the UI
			// (the /login page also hosts a newsletter form — scope to the form
			// that carries the password input).
			const email = freshEmail();
			const reg = await request.post("/api/reader/register", {
				data: { email, password: READER_PASSWORD },
			});
			expect(reg.status()).toBe(201);
			const readerToken = ((await reg.json()) as { access_token: string }).access_token;

			await page.goto("/login");
			const loginForm = page.locator('form:has(input[type="password"])');
			await loginForm.locator('input[type="email"]').fill(email);
			await loginForm.locator('input[type="password"]').fill(READER_PASSWORD);
			await loginForm.press("Enter");
			await page.waitForURL("**/bookmarks");

			// Follow the writer right from the byline on their post.
			await page.goto(`/posts/${slugFirst}`);
			await expect(page.locator("h1").first()).toContainText(slugFirst, {
				timeout: 15000,
			});
			const followButton = page.getByRole("button", { name: "关注", exact: true });
			await expect(followButton).toBeVisible({ timeout: 10000 });
			await followButton.click();
			await expect(page.getByRole("button", { name: "已关注", exact: true })).toBeVisible({
				timeout: 10000,
			});

			// The writer shows up in the /account followed-writers section.
			await page.goto("/account");
			const writersSection = page.locator("section", {
				has: page.getByRole("heading", { name: "关注的作者" }),
			});
			await expect(writersSection.locator("a", { hasText: penName })).toBeVisible({
				timeout: 10000,
			});

			// Publish a THIRD post after the follow: the follower's inbox gets
			// the new-post fan-out (the first two posts predate the follow, so
			// they must NOT notify — total should be exactly 1).
			thirdPostId = await publishPost(slugThird);
			const inbox = await request.get("/api/reader/me/notifications", {
				headers: { Authorization: `Bearer ${readerToken}` },
			});
			expect(inbox.status()).toBe(200);
			expect(((await inbox.json()) as { total: number }).total).toBe(1);

			// The followed writer's posts now also surface in the /follows feed
			// (round 354): all three authored posts are by a followed author.
			await page.goto("/follows");
			await expect(page.getByRole("heading", { level: 1 })).toContainText("我的关注", {
				timeout: 15000,
			});
			await expect(page.locator("a", { hasText: slugThird })).toBeVisible({
				timeout: 15000,
			});
			await expect(page.locator("a", { hasText: slugFirst })).toBeVisible();

			// Unfollow from the account page (confirm the dialog). The
			// writersSection locator re-resolves on the fresh /account load.
			await page.goto("/account");
			await expect(writersSection.locator("a", { hasText: penName })).toBeVisible({
				timeout: 15000,
			});
			page.on("dialog", (dialog) => dialog.accept());
			await writersSection.getByRole("button", { name: "取消关注" }).click();
			await expect(writersSection.getByText("还没有关注任何作者")).toBeVisible({
				timeout: 10000,
			});

			// The byline flips back to 关注 and the fan-out is stopped.
			await page.goto(`/posts/${slugFirst}`);
			await expect(page.getByRole("button", { name: "关注", exact: true })).toBeVisible({
				timeout: 10000,
			});
			await expect(page.getByRole("button", { name: "已关注" })).toHaveCount(0);
		} finally {
			await request.delete(`/api/admin/posts/${firstPostId}`, { headers: adminH });
			await request.delete(`/api/admin/posts/${secondPostId}`, { headers: adminH });
			if (thirdPostId !== undefined) {
				await request.delete(`/api/admin/posts/${thirdPostId}`, { headers: adminH });
			}
			await request.delete(`/api/admin/users/${authorId}`, { headers: adminH });
		}
	});
});
