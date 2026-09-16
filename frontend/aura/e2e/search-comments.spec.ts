/**
 * Comment search journey (round 366, DEC-405).
 *
 * The search page gains a ?type=comments mode that searches the discussion:
 * a reader who remembers a terse take in a thread (or wants every approved
 * comment that mentions a topic) can find it directly. A hit carries the
 * highlighted snippet, the commenter, and the post brief, and the card
 * deep-links ONTO the comment (#comment-{id}, DEC-321). This spec seeds a
 * comment with a unique marker, searches in comments mode from the public
 * UI, and lands on the exact comment.
 */

import { expect, test } from "@playwright/test";

async function postAndApprove(
	request: import("@playwright/test").APIRequestContext,
	content: string,
): Promise<{ postId: number; slug: string; commentId: number }> {
	const post = await request.get("/api/posts?limit=1");
	expect(post.status()).toBe(200);
	const { id: postId, slug } = (
		(await post.json()) as { items: Array<{ id: number; slug: string }> }
	).items[0];

	const created = await request.post(`/api/comments/post/${postId}`, {
		data: { nickname: "评论搜索侠", email: "search@example.com", content },
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
	return { postId, slug, commentId };
}

test.describe("Comment search (DEC-405)", () => {
	test("searches the discussion from the public UI and lands on the comment", async ({
		page,
		request,
	}) => {
		const marker = `评论搜索journey-${Date.now()}`;
		const { slug, commentId } = await postAndApprove(request, marker);

		await page.goto("/search");
		const searchInput = page.getByPlaceholder("输入关键词...");
		await searchInput.fill(marker);
		await searchInput.press("Enter");
		await page.waitForURL(/q=/);

		// Switch to comments mode via the tab.
		const commentsTab = page.getByRole("tab", { name: "评论" });
		await expect(commentsTab).toBeVisible();
		await commentsTab.click();
		await page.waitForURL(/type=comments/);

		// The hit renders the highlighted snippet; the card deep-links ONTO the
		// comment (the anchor's text is the post brief, not the marker).
		const card = page
			.locator("div.border")
			.filter({ has: page.locator("mark") })
			.filter({
				hasText: marker,
			});
		await expect(card).toBeVisible({ timeout: 10000 });
		const link = card.locator(`a[href*="#comment-${commentId}"]`);
		await expect(link).toBeVisible();

		// Land ON the comment.
		await link.click();
		await page.waitForURL(new RegExp(`#comment-${commentId}`));
		await expect(page.locator(`#comment-${commentId}`)).toBeVisible({ timeout: 10000 });
		expect(page.url()).toContain(`/posts/${slug}#comment-${commentId}`);
	});

	test("a fresh comment-search deep link lands straight in comments mode", async ({
		page,
		request,
	}) => {
		const marker = `深链评论${Date.now()}`;
		const { commentId, slug } = await postAndApprove(request, marker);

		await page.goto(`/search?q=${encodeURIComponent(marker)}&type=comments`);
		const card = page
			.locator("div.border")
			.filter({ has: page.locator("mark") })
			.filter({
				hasText: marker,
			});
		await expect(card).toBeVisible({ timeout: 10000 });
		const link = card.locator(`a[href*="#comment-${commentId}"]`);
		await expect(link).toHaveAttribute("href", new RegExp(`#comment-${commentId}$`));
		expect(slug.length).toBeGreaterThan(0);
	});
});
