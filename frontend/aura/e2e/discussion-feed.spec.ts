/**
 * Public discussion feed journey (round 367, DEC-407).
 *
 * Comment search (DEC-405) made the discussion findable; this page makes it
 * browsable. A visitor who wants to see what people are saying right now opens
 * /discussion and sees the newest approved comments across the site, each card
 * carrying the commenter, the content, and the post brief, and deep-linking
 * ONTO the exact comment (#comment-{id}, DEC-321). This spec seeds a comment
 * with a unique marker, opens the feed, finds it, and lands on the comment.
 */

import { expect, test } from "@playwright/test";

async function postAndApprove(
	request: import("@playwright/test").APIRequestContext,
	content: string,
): Promise<{ slug: string; commentId: number }> {
	const post = await request.get("/api/posts?limit=1");
	expect(post.status()).toBe(200);
	const { id: postId, slug } = (
		(await post.json()) as { items: Array<{ id: number; slug: string }> }
	).items[0];

	const created = await request.post(`/api/comments/post/${postId}`, {
		data: { nickname: "讨论流评论家", email: "feed@example.com", content },
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
	return { slug, commentId };
}

test.describe("Discussion feed (DEC-407)", () => {
	test("visitor browses the newest discussion and lands on a comment", async ({
		page,
		request,
	}) => {
		const marker = `讨论流marker-${Date.now()}`;
		const { slug, commentId } = await postAndApprove(request, marker);

		await page.goto("/discussion");

		// The newest approved comment appears (the seeded marker is freshest).
		const card = page.locator("div.border").filter({ hasText: marker });
		await expect(card).toBeVisible({ timeout: 10000 });
		await expect(card).toContainText("讨论流评论家");

		// The card deep-links ONTO the comment, not just the post headline.
		const link = card.locator(`a[href*="#comment-${commentId}"]`);
		await expect(link).toHaveAttribute("href", new RegExp(`#comment-${commentId}$`));

		// Land ON the comment.
		await link.click();
		await page.waitForURL(new RegExp(`#comment-${commentId}`));
		await expect(page.locator(`#comment-${commentId}`)).toBeVisible({ timeout: 10000 });
		expect(page.url()).toContain(`/posts/${slug}#comment-${commentId}`);
	});

	test("footer links to the discussion feed", async ({ page }) => {
		await page.goto("/");
		const footerLink = page.getByRole("link", { name: "最新讨论" });
		await expect(footerLink).toBeVisible();
		await footerLink.click();
		await page.waitForURL(/\/discussion/);
		await expect(page).toHaveURL(/\/discussion/);
	});
});
