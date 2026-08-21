/**
 * Reader-attributed comments journey (DEC-062, TASK-135/136).
 *
 * A signed-in reader posting a comment does so under their verified account
 * identity: the form shows the identity (no nickname/email inputs) and the
 * backend stamps the account's display_name. The submitted client nickname is
 * ignored (no spoofing).
 */

import { expect, test } from "@playwright/test";

let emailCounter = 0;
function freshEmail(): string {
	emailCounter += 1;
	return `commenter-${Date.now()}-${emailCounter}@example.com`;
}
const PASSWORD = "e2epass123";
const DISPLAY_NAME = "E2E Commenter";

async function registerReader(
	request: import("@playwright/test").APIRequestContext,
	email: string,
) {
	const resp = await request.post("/api/reader/register", {
		data: { email, password: PASSWORD, display_name: DISPLAY_NAME },
	});
	expect(resp.status()).toBe(201);
}

test.describe("Reader-attributed comments", () => {
	test("signed-in reader comments under their verified identity", async ({ page, request }) => {
		const email = freshEmail();
		await registerReader(request, email);

		// Open the first post (capture its href as a plain string — locators
		// re-resolve against the current page, and we navigate away for login).
		await page.goto("/");
		const postLink = page.locator("main a[href*='/posts/']").first();
		await postLink.waitFor({ state: "visible" });
		const postHref = (await postLink.getAttribute("href"))!;
		await page.goto(postHref);
		await page.locator("section").filter({ hasText: "评论" }).first().waitFor({ state: "visible" });

		// Sign in via the reader /login flow.
		await page.goto("/login");
		await page.locator('input[type="email"]').fill(email);
		await page.locator('input[type="password"]').fill(PASSWORD);
		await page.locator("form").press("Enter");
		// After login the default route is /bookmarks; navigate back to the post.
		await page.waitForURL("**/bookmarks");
		await page.goto(postHref);

		// The signed-in comment form shows the verified identity instead of the
		// nickname/email inputs (SSR renders the anonymous form first, so wait
		// for client hydration to flip the form to the reader identity).
		await expect(page.locator("#comment-content")).toBeVisible({ timeout: 10000 });
		await expect(page.locator("#reader-comment-identity")).toBeVisible({ timeout: 10000 });
		await expect(page.locator("#comment-nickname")).toHaveCount(0);
		await expect(page.locator("#comment-email")).toHaveCount(0);

		// Submit a comment; it's pending moderation but recorded with our identity.
		await page.locator("#comment-content").fill("A verified reader comment");
		await page.locator("button[type='submit']").first().click();
		await expect(page.locator("text=评论提交成功，等待审核中！")).toBeVisible({ timeout: 5000 });
	});

	test("reply deep-link lands the reader on the comment (DEC-072)", async ({
		page,
		request,
	}) => {
		// Plant an approved comment so it appears on the public list.
		const posts = await request.get("/api/posts?limit=1");
		const postLink = ((await posts.json()) as { items: Array<{ id: number; slug: string }> })
			.items[0];
		const created = await request.post(`/api/comments/post/${postLink.id}`, {
			data: {
				nickname: "DeepLink",
				email: "dl@example.com",
				content: "deep-link target comment",
			},
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

		// Visit the post URL with the comment anchor (what the reply notification
		// now opens) — the list must scroll so the anchored comment is in view.
		await page.goto(`/posts/${postLink.slug}#comment-${commentId}`);
		const el = page.locator(`#comment-${commentId}`);
		await expect(el).toBeVisible({ timeout: 10000 });
		// The page must scroll so the anchored comment lands at (or just at) the
		// fold — a fresh top-of-page load would leave it far below. A last-
		// comment-at-page-bottom can sit a few px past the fold at max scroll.
		await expect
			.poll(
				async () => {
					const [scrollTop, box, vh] = await Promise.all([
						page.evaluate(() => document.scrollingElement?.scrollTop ?? 0),
						el.boundingBox(),
						page.evaluate(() => window.innerHeight),
					]);
					if (!box) return false;
					return scrollTop > 100 && box.y < vh + 60 && box.y + box.height > 0;
				},
				{ timeout: 10000 },
			)
			.toBe(true);
	});
});
