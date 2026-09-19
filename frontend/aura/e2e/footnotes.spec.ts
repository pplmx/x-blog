import { expect, test } from "@playwright/test";

/**
 * GFM inline footnotes render on the post page (DEC-441, TASK-451).
 *
 * Journey: publish a post whose content carries a `[^1]` / `[^1]: ...` citation
 * marker, visit its page, and confirm the raw marker is gone — replaced by a
 * backlinked <sup> reference and a definition list, exactly as the frontend
 * marked extension emits. Before DEC-441 this same content rendered the
 * literal `[^1]` text (the author's citation leaked into the article).
 */
test("publish a footnoted post and see the citation render, not leak", async ({
	request,
	page,
}) => {
	// Admin login for an authenticated publish (mirrors trending-home — the
	// OAuth2 password flow expects form data, not a JSON body).
	const login = await request.post("/api/admin/login", {
		form: { username: "admin", password: "admin123" },
	});
	expect(login.status()).toBe(200);
	const adminH = { Authorization: `Bearer ${(await login.json()).access_token}` };

	const title = `Footnotes e2e ${Date.now()}`;
	const slug = `footnotes-e2e-${Date.now()}`;
	const body = [
		"# Footnotes",
		"",
		"Citations make an article traceable[^1] and re-usable[^2].",
		"",
		"[^1]: The first **source** link.",
		"[^2]: A second source.",
	].join("\n");

	const created = await request.post("/api/posts", {
		data: { title, slug, content: body, published: true },
		headers: adminH,
	});
	expect(created.status()).toBe(201);
	const postId = (await created.json()).id;

	await page.goto(`/posts/${slug}`);

	// In-prose reference: an <a> inside a <sup> pointing down to the definition
	// (the anchor's `#fn:1` href is the journal link target).
	await expect(page.locator('a[href="#fn:1"]')).toBeVisible();
	await expect(page.locator('a[href="#fn:2"]')).toBeVisible();

	// The definition list is present: each <li> carries the matching id and the
	// source body renders (bold survives as markdown inside the footnote).
	await expect(page.locator('li[id="fn:1"]')).toContainText("The first source link.");
	await expect(page.locator('li[id="fn:2"]')).toContainText("A second source.");
	await expect(page.locator('li[id="fn:1"] strong')).toHaveText("source");

	// A backlink ("↩") returns to the in-text marker.
	await expect(page.locator('a[href="#fnref:1"]')).toBeVisible();

	// The raw GFM marker must never leak into the rendered article.
	await expect(page.getByText("[^1]", { exact: false })).not.toBeVisible();

	// Cleanup: remove the test post so repeated runs stay idempotent.
	await request.delete(`/api/posts/${postId}`, { headers: adminH });
});
