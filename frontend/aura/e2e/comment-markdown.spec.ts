/**
 * Comment Markdown rendering journey (DEC-088, TASK-156).
 *
 * Comment content renders through the same sanitized markdown pipeline as post
 * content (marked with breaks:true, then sanitizeHtml): a fenced code block,
 * inline emphasis and single-newline prose become real HTML. Two safety halves
 * are pinned too — a <script> payload never reaches the DOM (so it can never
 * execute) and a javascript: link is neutralized to an inert href.
 *
 * Comments are seeded via the API and approved as admin (the public list only
 * shows approved comments), then the post page is loaded in a real browser.
 * Every assertion is scoped to the comment's own `#comment-<id>` anchor so
 * re-runs against a shared dev DB (which accumulates duplicate test comments)
 * stay deterministic.
 */

import { expect, test } from "@playwright/test";

// breaks:true keeps single newlines as <br> (comment prose, unlike post prose).
const MARKDOWN_COMMENT = [
	"Fenced code renders below:",
	"this second line stays in the same paragraph",
	"```ts",
	"const x = 1;",
	"```",
	"and **bold** plus `inline` stay inline.",
].join("\n");

// Mixed XSS payload: a <script> element, an onerror handler and a
// javascript: link — none of which may survive the sanitizer.
const XSS_COMMENT =
	'hello <script id="evil">window.__xss=1</script> <img src=x onerror="alert(1)"> [click](javascript:alert(1))';

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
		data: { nickname: "MdTester", email: "md@example.com", content },
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

test.describe("Comment Markdown rendering (DEC-088)", () => {
	test("code block + emphasis render; script/event-handler/javascript: payloads are neutralized", async ({
		page,
		request,
	}) => {
		const post = await firstPost(request);
		const mdId = await postAndApprove(request, post.id, MARKDOWN_COMMENT);
		const xssId = await postAndApprove(request, post.id, XSS_COMMENT);

		// Scope every assertion to its own comment anchor so identical comments
		// left behind by earlier runs can't trip strict mode.
		await page.goto(`/posts/${post.slug}#comment-${mdId}`);
		const mdBody = page.locator(`#comment-${mdId} .comment-body`);
		await expect(mdBody).toBeVisible({ timeout: 10000 });

		// Markdown half: the fence became a <pre><code>, bold and inline code
		// render as elements, and single newlines survive as <br> (breaks).
		const pre = mdBody.locator("pre code.language-ts");
		await expect(pre).toBeVisible();
		await expect(pre).toContainText("const x = 1;");
		await expect(mdBody.locator("strong")).toHaveText("bold");
		await expect(mdBody.locator("code", { hasText: "inline" })).toBeVisible();
		// breaks:true turns the paragraph's single newline into a <br> (a
		// zero-height element — count it rather than asserting visibility).
		expect(await mdBody.locator("br").count()).toBeGreaterThan(0);

		// Syntax highlighting (DEC-090): the lazy highlight.js pass tokenizes
		// the fence after mount; `const` becomes an .hljs-keyword span. This is
		// the acceptance — a code block in a comment shows token colors.
		const highlighted = mdBody.locator("pre code.language-ts .hljs-keyword");
		await expect(highlighted.first()).toBeVisible({ timeout: 10000 });
		expect(await highlighted.count()).toBeGreaterThan(0);

		// XSS half: the script/event-handler comment rendered its text but none
		// of the payload produced a live node.
		const xssBody = page.locator(`#comment-${xssId} .comment-body`);
		await expect(xssBody).toBeVisible();
		expect(await xssBody.locator("script").count()).toBe(0);
		expect(await xssBody.locator("[onerror]").count()).toBe(0);
		expect(await xssBody.locator('a[href^="javascript:"]').count()).toBe(0);
		// The neutralized link still renders but is inert: DOMPurify removes
		// the href attribute entirely, while the regex fallback empties it —
		// neither may leave a live javascript: scheme.
		const link = xssBody.locator("a", { hasText: "click" });
		await expect(link).toBeVisible();
		const href = await link.getAttribute("href");
		expect(href === null || !href.toLowerCase().startsWith("javascript:")).toBe(true);

		// The script payload never executed in the page context.
		const xss = await page.evaluate(() => (window as { __xss?: number }).__xss);
		expect(xss).toBeUndefined();
	});
});
