/**
 * Reader avatar journey (DEC-299, TASK-378).
 *
 * A registered reader uploads a profile picture from /account; it renders
 * beside their identity on the public reader profile page and next to an
 * approved comment they leave on a post. Covers the full loop: upload →
 * placeholder replaced → public surfaces show the picture → removal clears it.
 */

import { expect, test } from "@playwright/test";

let emailCounter = 0;
function freshEmail(): string {
	emailCounter += 1;
	return `avatar-${Date.now()}-${emailCounter}@example.com`;
}
const PASSWORD = "e2epass123";

// A tiny, genuinely decodable 1x1 PNG (so Playwright can attach it regardless
// of whether the file lives on disk; uploads are validated by content, not by
// byte size).
const PNG_BYTES = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
	"base64",
);

async function registerReader(
	request: import("@playwright/test").APIRequestContext,
	email: string,
	displayName: string,
): Promise<{ token: string; readerId: number }> {
	const resp = await request.post("/api/reader/register", {
		data: { email, password: PASSWORD, display_name: displayName },
	});
	expect(resp.status()).toBe(201);
	const body = (await resp.json()) as { access_token: string; reader: { id: number } };
	return { token: body.access_token, readerId: body.reader.id };
}

async function adminToken(request: import("@playwright/test").APIRequestContext): Promise<string> {
	const login = await request.post("/api/admin/login", {
		form: { username: "admin", password: "admin123" },
	});
	expect(login.status()).toBe(200);
	return (await login.json()).access_token as string;
}

async function pickPost(
	request: import("@playwright/test").APIRequestContext,
): Promise<{ id: number; slug: string } | null> {
	const posts = await request.get("/api/posts?limit=1");
	expect(posts.status()).toBe(200);
	const data = (await posts.json()) as { items: Array<{ id: number; slug: string }> };
	return data.items?.[0] ?? null;
}

test.describe("Reader avatar (DEC-299)", () => {
	test("upload shows the picture on the profile page and next to a comment; removal clears it", async ({
		page,
		request,
	}) => {
		const post = await pickPost(request);
		if (!post) {
			test.skip();
			return;
		}

		const email = freshEmail();
		const { token, readerId } = await registerReader(request, email, "Avatar Reader");

		// Sign in and open account settings.
		await page.goto("/login");
		await page.locator('input[type="email"]').fill(email);
		await page.locator('input[type="password"]').fill(PASSWORD);
		await page.locator("form").press("Enter");
		await page.waitForURL("**/bookmarks");
		await page.goto("/account");

		// No avatar yet → the initial-letter placeholder (no <img>).
		await expect(page.locator("h2", { hasText: "个人资料" })).toBeVisible({ timeout: 10000 });
		await expect(page.locator("img").first()).not.toBeVisible();

		// Upload a picture via the hidden file input.
		await page.locator('input[type="file"]').setInputFiles({
			name: "avatar.png",
			mimeType: "image/png",
			buffer: PNG_BYTES,
		});
		// The replace/upload response refreshes the profile; the image renders.
		await expect(page.locator("img").first()).toBeVisible({ timeout: 10000 });

		// Leave an approved comment as this reader, then confirm the avatar is
		// rendered next to their name on the public post page.
		const comment = await request.post(`/api/comments/post/${post.id}`, {
			data: {
				nickname: "anonymous-placeholder",
				email: "reader@example.com",
				content: "Avatar journey comment",
			},
			headers: { Authorization: `Bearer ${token}` },
		});
		expect(comment.status()).toBe(201);
		const commentId = ((await comment.json()) as { id: number }).id;
		const approved = await request.patch(`/api/comments/${commentId}/approve`, {
			data: { approved: true },
			headers: { Authorization: `Bearer ${await adminToken(request)}` },
		});
		expect(approved.status()).toBe(200);

		await page.goto(`/posts/${post.slug}`);
		// The comment's reader avatar is rendered (an <img> under /static/avatars/).
		const avatar = page.locator(`#comment-${commentId} img[src^="/static/avatars/"]`);
		await expect(avatar).toBeVisible({ timeout: 10000 });

		// The public profile page for this reader shows the same picture.
		await page.goto(`/readers/${readerId}`);
		await expect(page.locator('img[src^="/static/avatars/"]')).toBeVisible({ timeout: 10000 });

		// Removal clears the picture; the placeholder returns.
		await page.goto("/account");
		await page.getByRole("button", { name: "移除" }).click();
		await expect(page.locator("img").first()).not.toBeVisible({ timeout: 10000 });
	});
});
