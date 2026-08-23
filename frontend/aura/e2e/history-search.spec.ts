/**
 * Reading-history search journey (DEC-148, TASK-186).
 *
 * A signed-in reader can search their past-read posts on /history by a term
 * matching the title; a non-matching term yields the empty search state.
 */

import { expect, test } from "@playwright/test";

const PASSWORD = "e2epass123";
let emailCounter = 0;
function freshEmail(): string {
	emailCounter += 1;
	return `hist-search-${Date.now()}-${emailCounter}@example.com`;
}

test.describe("History search (TASK-186)", () => {
	test("a signed-in reader searches their history", async ({ page, request }) => {
		// Pick a published post to record as viewed.
		const posts = await request.get("/api/posts?limit=1");
		expect(posts.status()).toBe(200);
		const postList = (await posts.json()) as { items: Array<{ id: number; title: string }> };
		if (!postList.items?.length) {
			test.skip();
			return;
		}
		const post = postList.items[0];

		// Register, sign in, and record the post in server history.
		const email = freshEmail();
		const reg = await request.post("/api/reader/register", {
			data: { email, password: PASSWORD, display_name: "Hist Search E2E" },
		});
		expect(reg.status()).toBe(201);
		const token = ((await reg.json()) as { access_token: string }).access_token;
		await page.addInitScript((tk) => localStorage.setItem("reader_token", tk), token);
		const view = await request.post(`/api/reader/me/history/${post.id}`, {
			headers: { Authorization: `Bearer ${token}` },
		});
		expect(view.status()).toBe(200);

		// Search for a distinctive word in the title.
		await page.goto("/history");
		const search = page.getByPlaceholder("搜索阅读历史…");
		await expect(search).toBeVisible();
		const term = post.title.split(/\s+/)[0] ?? post.title;
		await search.fill(term);
		await expect(page.locator("main a", { hasText: post.title }).first()).toBeVisible({
			timeout: 10000,
		});

		// A non-matching term shows the empty-search state.
		await search.fill("zzz-no-such-term-xyz");
		await expect(page.locator("body")).toContainText("没有匹配的阅读记录", {
			timeout: 10000,
		});
	});
});
