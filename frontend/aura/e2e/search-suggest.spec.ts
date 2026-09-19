/**
 * "Did you mean" search-suggestion journey (round 390, DEC-443).
 *
 * The post search is exact substring/tsvector with no fuzzy layer, so a
 * one-typo query dead-ends on an empty page. This spec seeds a published post
 * whose TITLE is the recovery target, types a query that differs by ONE
 * Chinese character (异步编程实贱 instead of 异步编程实战 — never a substring of
 * the content, so the post search returns zero hits), and verifies the empty
 * state offers the corrected title as a suggestion chip; tapping it re-runs
 * the search and lands on the seeded post.
 *
 * Deliberately exercises the TITLE vocabulary: post titles are fetched fresh
 * from the DB per suggest call (no module-level cache), so the run cannot race
 * the 30-minute tag/category taxonomy cache shared by parallel specs.
 */

import { expect, test } from "@playwright/test";

test("recovers a typo'd search via a did-you-mean suggestion", async ({ page, request }) => {
	// Unique per run: the assertion targets the suggestion chip/link by the
	// exact title text, so a leftover post from a previous run (same title)
	// would trip Playwright's strict-mode "resolved to N elements".
	const title = `异步编程实战·${Date.now() % 100000}`;
	const slug = `suggest-cjk-${Date.now()}`;

	const adminLogin = await request.post("/api/admin/login", {
		form: { username: "admin", password: "admin123" },
	});
	expect(adminLogin.status()).toBe(200);
	const adminH = {
		Authorization: `Bearer ${(await adminLogin.json()).access_token}`,
	};

	// Title-only recovery target: content also carries the exact title text,
	// but the typo'd query (实贱) is never a substring, so the hit count is 0.
	const createdPost = await request.post("/api/posts", {
		data: { title, slug, content: "# 异步编程实战\n正文：编写更快的异步代码", published: true },
		headers: adminH,
	});
	expect(createdPost.status()).toBe(201);
	const postId = (await createdPost.json()).id;

	try {
		// 战 → 贱: exactly one edit away from the (unique) title.
		const typo = title.replace("战", "贱");
		await page.goto(`/search?q=${encodeURIComponent(typo)}`);

		// The zero-hit empty state renders the classic hint...
		await expect(page.getByText("没有找到相关文章")).toBeVisible();

		// ...and the edit-distance suggestion for the real title.
		const region = page.getByRole("region", { name: "你是不是想找：" });
		await expect(region).toBeVisible();
		const chip = region.getByRole("button", { name: title });
		await expect(chip).toBeVisible();

		// Tapping it re-runs the search with the corrected term and lands on
		// the seeded post.
		await chip.click();
		await expect(page).toHaveURL(new RegExp(`q=${encodeURIComponent(title)}`));
		await expect(page.getByRole("link", { name: title })).toBeVisible();
	} finally {
		// Cleanup so repeated runs stay idempotent.
		await request.delete(`/api/posts/${postId}`, { headers: adminH });
	}
});
