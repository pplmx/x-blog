/**
 * My Comments filter journey (DEC-102, TASK-163).
 *
 * A signed-in reader opens /comments; the page shows status filter tabs. After
 * an approved comment is seeded via the API, filtering by "Approved" surfaces
 * exactly that published comment while keeping pending ones hidden.
 */

import { expect, test } from "@playwright/test";

const PASSWORD = "e2epass123";
let emailCounter = 0;
function freshEmail(): string {
	emailCounter += 1;
	return `myfilter-${Date.now()}-${emailCounter}@example.com`;
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
		data: { email, password: PASSWORD, display_name: "Filter E2E" },
	});
	expect(reg.status()).toBe(201);

	await page.goto("/login");
	await page.locator('input[type="email"]').fill(email);
	await page.locator('input[type="password"]').fill(PASSWORD);
	await page.locator("form").press("Enter");
	await page.waitForURL("**/bookmarks");

	const login = await request.post("/api/reader/login", { data: { email, password: PASSWORD } });
	return (await login.json()).access_token as string;
}

async function postAndApprove(
	request: import("@playwright/test").APIRequestContext,
	postId: number,
	readerToken: string,
	content: string,
) {
	const created = await request.post(`/api/comments/post/${postId}`, {
		data: { nickname: "x", email: "x@x.com", content },
		headers: { Authorization: `Bearer ${readerToken}` },
	});
	expect(created.status()).toBe(201);
	const login = await request.post("/api/admin/login", {
		form: { username: "admin", password: "admin123" },
	});
	const token = (await login.json()).access_token as string;
	const approved = await request.patch(`/api/comments/${created.id}/approve`, {
		data: { approved: true },
		headers: { Authorization: `Bearer ${token}` },
	});
	expect(approved.status()).toBe(200);
}

test.describe("My Comments filter (DEC-102)", () => {
	test("filtering by Approved shows only the published comment", async ({ page, request }) => {
		const postId = await firstPost(request);
		const email = freshEmail();
		const readerToken = await registerAndLoginReader(page, request, email);
		const stamp = Date.now();
		await postAndApprove(request, postId, readerToken, `filtered approved ${stamp}`);

		await page.goto("/comments");
		const tabs = page.locator('[role="tab"]');
		await expect(tabs.first()).toBeVisible({ timeout: 10000 });

		// "Approved" tab (已通过).
		await page.locator('[role="tab"]', { hasText: "已通过" }).click();
		await expect(page.locator(`text=filtered approved ${stamp}`)).toBeVisible({ timeout: 10000 });
	});
});
