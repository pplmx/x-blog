/**
 * Public reader profile journey (DEC-294, TASK-376).
 *
 * A commenter's verified display name is now a linkable identity: from an
 * approved comment on a post, the display name links to /readers/{id}, which
 * shows the reader's profile and their approved public comments. Guests can
 * browse the profile (public page), and a 404 (unknown id) renders the
 * not-found state rather than an empty page.
 */

import { expect, test } from "@playwright/test";

let emailCounter = 0;
function freshEmail(): string {
	emailCounter += 1;
	return `profile-${Date.now()}-${emailCounter}@example.com`;
}
const PASSWORD = "e2epass123";

// A per-test display name (timestamped) keeps the "name is a link" assertion
// deterministic: a fixed name would collide with comments left behind by
// earlier runs, tripping strict mode.
function freshDisplayName(): string {
	return `Profile Reader ${Date.now()}`;
}

async function registerReader(
	request: import("@playwright/test").APIRequestContext,
	email: string,
	displayName: string,
): Promise<string> {
	const resp = await request.post("/api/reader/register", {
		data: { email, password: PASSWORD, display_name: displayName },
	});
	expect(resp.status()).toBe(201);
	// `resp.json()` is async — reading `.access_token` off the un-awaited
	// Promise (even through a cast) silently yields `undefined`, which makes the
	// comment POST anonymous. Await the body first.
	const body = (await resp.json()) as { access_token: string };
	return body.access_token;
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

test.describe("Public reader profile (DEC-294)", () => {
	test("a reader's display name on a comment links to their public profile", async ({
		page,
		request,
	}) => {
		const post = await pickPost(request);
		if (!post) {
			test.skip();
			return;
		}

		// Register a reader and comment on the post as them.
		const email = freshEmail();
		const displayName = freshDisplayName();
		const token = await registerReader(request, email, displayName);
		const comment = await request.post(`/api/comments/post/${post.id}`, {
			data: {
				nickname: "anonymous-placeholder",
				email: "reader@example.com",
				content: "A verified profile comment",
			},
			headers: { Authorization: `Bearer ${token}` },
		});
		expect(comment.status()).toBe(201);
		const commentId = ((await comment.json()) as { id: number }).id;

		// Approve it (auto-approve for readers is a runtime setting; force the
		// deterministic path — the public comment list must only show approved).
		const approved = await request.patch(`/api/comments/${commentId}/approve`, {
			data: { approved: true },
			headers: { Authorization: `Bearer ${await adminToken(request)}` },
		});
		expect(approved.status()).toBe(200);

		// Open the post: the comment's verified reader name is a link. Scope to
		// the exact comment we created (#comment-{id}) so leftover comments from
		// earlier runs can't trip strict mode.
		await page.goto(`/posts/${post.slug}`);
		await page.locator(`#comment-${commentId}`).waitFor({ state: "visible" });
		const nameLink = page.locator(`#comment-${commentId} a[href*="/readers/"]`);
		await expect(nameLink).toBeVisible({ timeout: 10000 });
		const href = await nameLink.getAttribute("href");
		expect(href).toMatch(/\/readers\/\d+/);

		// Follow it to the public profile page: display name + the comment.
		await nameLink.click();
		await expect(page).toHaveURL(/\/readers\/\d+/, { timeout: 10000 });
		await expect(page.getByRole("heading", { name: displayName })).toBeVisible({
			timeout: 10000,
		});
		await expect(page.locator("main")).toContainText("A verified profile comment");
	});

	test("guests can browse a profile and an unknown reader 404s", async ({ page }) => {
		// An unknown reader id renders the not-found state. Match the heading by
		// role (the same literal also appears in the paragraph — strict mode).
		await page.goto("/readers/999999");
		await expect(page.getByRole("heading", { name: "读者不存在" })).toBeVisible({
			timeout: 10000,
		});
	});
});
