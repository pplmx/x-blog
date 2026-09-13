/**
 * Comment-image lightbox journey (DEC-308, TASK-382).
 *
 * The post body opens MarkdownLightbox for its images (DEC-302) but the
 * comment body — same marked+sanitizer pipeline — previously rendered pasted
 * images as plain, column-width, un-scrutinizable <img>. This spec pins the
 * completion: clicking an image inside a comment opens the same fullscreen
 * viewer, scoped to that comment's own image set, and a hostile src can
 * never open it.
 *
 * A comment with markdown images is seeded via the API and approved as admin
 * (the public list only shows approved comments); the post page is then loaded
 * in a real browser and assertions are scoped to the comment's anchor so
 * re-runs against a shared dev DB stay deterministic.
 */

import { expect, test } from "@playwright/test";

// An http(s) src survives commentBodyHtml's sanitizer and renders as a real
// <img> (it does not need to resolve — the lightbox opens on click regardless).
const IMG_CHROME = "https://example.invalid/img-chrome.png";
const IMG_COUNTER = "https://example.invalid/img-counter.png";
const IMAGE_COMMENT = `Two screenshots below:\n\n![chrome](${IMG_CHROME})\n\n![counter](${IMG_COUNTER})`;
// A seconds image with a javascript: src — sanitized → dead src, no viewer slot.
const XSS_IMAGE_COMMENT =
	"Hostile: ![x](javascript:window.__clb=1) plus a normal ![ok](https://example.invalid/ok.png)";

async function firstPost(
	request: import("@playwright/test").APIRequestContext,
): Promise<{ id: number; slug: string }> {
	const resp = await request.get("/api/posts?limit=1");
	expect(resp.status()).toBe(200);
	return ((await resp.json()) as { items: Array<{ id: number; slug: string }> }).items[0];
}

/** Post a comment as an anonymous visitor then approve it as admin. */
async function postAndApprove(
	request: import("@playwright/test").APIRequestContext,
	postId: number,
	content: string,
): Promise<number> {
	const created = await request.post(`/api/comments/post/${postId}`, {
		data: { nickname: "ImgTester", email: "imgtester@example.com", content },
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
	return commentId;
}

test.describe("Comment image lightbox (DEC-308)", () => {
	test("clicking a comment image opens the fullscreen viewer scoped to that comment", async ({
		page,
		request,
	}) => {
		const post = await firstPost(request);
		const commentId = await postAndApprove(request, post.id, IMAGE_COMMENT);

		await page.goto(`/posts/${post.slug}#comment-${commentId}`);
		const body = page.locator(`#comment-${commentId} .comment-body`);
		await expect(body.locator("img")).toHaveCount(2);
		const first = body.locator("img").first();
		await expect(first).toBeVisible({ timeout: 10000 });

		// Click opens the shared viewer at the clicked image.
		await first.click();
		const dialog = page.locator('[data-testid="lightbox"]');
		await expect(dialog).toBeVisible({ timeout: 10000 });
		await expect(page.locator('[data-testid="lightbox-image"]')).toHaveAttribute("src", IMG_CHROME);
		// The browse set is THIS comment's two images, not the whole page's.
		await expect(page.locator('[data-testid="lightbox-counter"]')).toHaveText("1 / 2");

		// Arrow right walks to the second comment image (wrap-around exists too).
		await page.keyboard.press("ArrowRight");
		await expect(page.locator('[data-testid="lightbox-image"]')).toHaveAttribute(
			"src",
			IMG_COUNTER,
		);
		await expect(page.locator('[data-testid="lightbox-counter"]')).toHaveText("2 / 2");

		// Escape closes and body scroll-lock is released (backdrop click covered
		// by the post-lightbox spec — this journey pins the comment wiring).
		await page.keyboard.press("Escape");
		await expect(dialog).toBeHidden();
		expect(await page.evaluate(() => document.body.style.overflow)).toBe("");
	});

	test("a javascript: image src never opens the comment viewer", async ({ page, request }) => {
		const post = await firstPost(request);
		const commentId = await postAndApprove(request, post.id, XSS_IMAGE_COMMENT);

		await page.goto(`/posts/${post.slug}#comment-${commentId}`);
		const body = page.locator(`#comment-${commentId} .comment-body`);
		await expect(body.locator("img")).toHaveCount(2, { timeout: 10000 });
		// The sanitized javascript: image survives only as alt-text — attribute
		// removed by the sanitizer, so it is no longer a loadable/clickable
		// image and never a browser-sourced payload. Assert no img carries a
		// live javascript: scheme.
		const imgs = await body.locator("img").all();
		for (const img of imgs) {
			const src = (await img.getAttribute("src")) ?? "";
			expect(src.startsWith("javascript:")).toBe(false);
		}

		// Clicking the surviving safe image opens the viewer for THAT image only.
		await imgs[imgs.length - 1].click();
		await expect(page.locator('[data-testid="lightbox"]')).toBeVisible({ timeout: 10000 });
		await expect(page.locator('[data-testid="lightbox-image"]')).toHaveAttribute(
			"src",
			"https://example.invalid/ok.png",
		);
		await expect(page.locator('[data-testid="lightbox-counter"]')).toHaveText("1 / 1");
		await page.keyboard.press("Escape");
		await expect(page.locator('[data-testid="lightbox"]')).toBeHidden();

		// The hostile payload never executed.
		expect(await page.evaluate(() => (window as { __clb?: number }).__clb)).toBeUndefined();
	});
});
