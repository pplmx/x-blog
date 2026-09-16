/**
 * My Comments keyword search journey (DEC-411, TASK-431).
 *
 * A signed-in reader with several comments opens /comments, types a term into
 * the recall-search box, and the list narrows to the comments whose content
 * matches (server-side). A non-matching term shows the search-aware empty
 * state with a one-click "Clear search" reset that restores the full list.
 */

import { expect, test } from "@playwright/test";

const PASSWORD = "e2epass123";
let emailCounter = 0;
function freshEmail(): string {
	emailCounter += 1;
	return `mysearch-${Date.now()}-${emailCounter}@example.com`;
}

async function firstPost(request: import("@playwright/test").APIRequestContext): Promise<number> {
	const resp = await request.get("/api/posts?limit=1");
	expect(resp.status()).toBe(200);
	return ((await resp.json()) as { items: Array<{ id: number }> }).items[0].id;
}

async function registerAndLoginReader(
	page: import("@playwright/test").Page,
	request: import("@playwright/test").APIRequestContext,
	email: string,
): Promise<string> {
	const reg = await request.post("/api/reader/register", {
		data: { email, password: PASSWORD, display_name: "Search E2E" },
	});
	expect(reg.status()).toBe(201);

	await page.goto("/login");
	await page.locator("main input[type='email']").fill(email);
	await page.locator('input[type="password"]').fill(PASSWORD);
	await page.locator("main form").press("Enter");
	await page.waitForURL("**/bookmarks");

	const login = await request.post("/api/reader/login", { data: { email, password: PASSWORD } });
	return (await login.json()).access_token as string;
}

test.describe("My Comments search (DEC-411)", () => {
	test("keyword search narrows the history and a clear-search reset restores it", async ({
		page,
		request,
	}) => {
		const postId = await firstPost(request);
		const email = freshEmail();
		const readerToken = await registerAndLoginReader(page, request, email);
		const stamp = Date.now();
		// Two comments; only one carries the distinctive term.
		await request.post(`/api/comments/post/${postId}`, {
			data: { nickname: "x", email: "x@x.com", content: `rust borrow checker tips ${stamp}` },
			headers: { Authorization: `Bearer ${readerToken}` },
		});
		await request.post(`/api/comments/post/${postId}`, {
			data: { nickname: "x", email: "x@x.com", content: `a cake recipe ${stamp}` },
			headers: { Authorization: `Bearer ${readerToken}` },
		});

		await page.goto("/comments");
		const searchBox = page.getByPlaceholder("搜索我的评论…");
		await expect(searchBox).toBeVisible({ timeout: 10000 });

		// Both comments visible before searching.
		await expect(page.locator(`text=rust borrow checker tips ${stamp}`)).toBeVisible({
			timeout: 10000,
		});
		await expect(page.locator(`text=a cake recipe ${stamp}`)).toBeVisible();

		// Search narrows to the matching comment only (debounced server-side).
		await searchBox.fill("borrow");
		await expect(page.locator(`text=rust borrow checker tips ${stamp}`)).toBeVisible({
			timeout: 10000,
		});
		await expect(page.locator(`text=a cake recipe ${stamp}`)).not.toBeVisible();

		// A non-matching term shows the search-aware empty state, not the
		// "never commented" copy.
		await searchBox.fill("zzz-no-such-comment");
		await expect(page.locator(`text=没有匹配「zzz-no-such-comment」的评论`)).toBeVisible({
			timeout: 10000,
		});

		// Clear search restores the full history. Exact match: the box's own
		// x-button (aria-label "清除搜索词") would otherwise collide in strict mode.
		await page.getByRole("button", { name: "清除搜索", exact: true }).click();
		await expect(page.locator(`text=rust borrow checker tips ${stamp}`)).toBeVisible({
			timeout: 10000,
		});
		await expect(page.locator(`text=a cake recipe ${stamp}`)).toBeVisible();
	});
});
