/**
 * Liked-posts recall-search journey (DEC-413, TASK-432).
 *
 * A signed-in reader with several liked posts opens /liked and types a term
 * into the search box: the grid narrows to the liked posts whose title or
 * excerpt matches (server-side). A non-matching term shows the search-aware
 * empty state with a one-click "Clear search" reset that restores the full
 * grid.
 */

import { expect, test } from "@playwright/test";

const PASSWORD = "e2epass123";
let emailCounter = 0;
function freshEmail(): string {
	emailCounter += 1;
	return `likedsearch-${Date.now()}-${emailCounter}@example.com`;
}

async function adminToken(request: import("@playwright/test").APIRequestContext): Promise<string> {
	const login = await request.post("/api/admin/login", {
		form: { username: "admin", password: "admin123" },
	});
	expect(login.status()).toBe(200);
	return (await login.json()).access_token as string;
}

/** Create a controlled published post so the search term is deterministic. */
async function createPost(
	request: import("@playwright/test").APIRequestContext,
	token: string,
	title: string,
	slug: string,
): Promise<number> {
	const resp = await request.post("/api/posts", {
		data: { title, slug, content: "# Hello", published: true },
		headers: { Authorization: `Bearer ${token}` },
	});
	expect(resp.status()).toBe(201);
	return ((await resp.json()) as { id: number }).id;
}

async function registerAndLoginReader(
	page: import("@playwright/test").Page,
	request: import("@playwright/test").APIRequestContext,
	email: string,
): Promise<string> {
	const reg = await request.post("/api/reader/register", {
		data: { email, password: PASSWORD, display_name: "Liked Search E2E" },
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

test.describe("Liked posts search (DEC-413)", () => {
	test("keyword search narrows the liked grid and a clear-search reset restores it", async ({
		page,
		request,
	}) => {
		const email = freshEmail();
		const readerToken = await registerAndLoginReader(page, request, email);
		const stamp = Date.now();
		const admin = await adminToken(request);
		// Two liked posts; only one carries the distinctive term.
		const borrow = await createPost(
			request,
			admin,
			`rust borrow checker theory ${stamp}`,
			`borrow-${stamp}`,
		);
		const cake = await createPost(request, admin, `a cake recipe ${stamp}`, `cake-${stamp}`);
		for (const id of [borrow, cake]) {
			const like = await request.post(`/api/reader/me/likes/${id}`, {
				headers: { Authorization: `Bearer ${readerToken}` },
			});
			expect(like.status()).toBe(201);
		}

		await page.goto("/liked");
		const searchBox = page.getByPlaceholder("搜索喜欢的文章…");
		await expect(searchBox).toBeVisible({ timeout: 10000 });

		// Both liked posts visible before searching.
		await expect(page.locator(`text=rust borrow checker theory ${stamp}`)).toBeVisible({
			timeout: 10000,
		});
		await expect(page.locator(`text=a cake recipe ${stamp}`)).toBeVisible();

		// Search narrows to the matching liked post only (debounced server-side).
		await searchBox.fill("borrow");
		await expect(page.locator(`text=rust borrow checker theory ${stamp}`)).toBeVisible({
			timeout: 10000,
		});
		await expect(page.locator(`text=a cake recipe ${stamp}`)).not.toBeVisible();

		// A non-matching term shows the search-aware empty state, not the
		// "haven't liked anything" copy.
		await searchBox.fill("zzz-no-such-post");
		await expect(page.locator(`text=没有匹配「zzz-no-such-post」的文章`)).toBeVisible({
			timeout: 10000,
		});

		// Clear search restores the full grid. Exact match: the box's own
		// x-button (aria-label "清除搜索词") would otherwise collide in strict mode.
		await page.getByRole("button", { name: "清除搜索", exact: true }).click();
		await expect(page.locator(`text=rust borrow checker theory ${stamp}`)).toBeVisible({
			timeout: 10000,
		});
		await expect(page.locator(`text=a cake recipe ${stamp}`)).toBeVisible();
	});
});
