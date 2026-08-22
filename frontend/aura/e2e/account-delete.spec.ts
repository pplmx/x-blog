/**
 * Reader self-service account deletion journey (DEC-106, TASK-165).
 *
 * A signed-in reader deletes their account from /account with their password.
 * Afterwards the account can't authenticate and the reader's past comment
 * remains public but anonymized (identity detached).
 */

import { expect, test } from "@playwright/test";

const PASSWORD = "readerpass123";
let emailCounter = 0;
function freshEmail(): string {
	emailCounter += 1;
	return `delacct-${Date.now()}-${emailCounter}@example.com`;
}

async function firstPost(
	request: import("@playwright/test").APIRequestContext,
): Promise<{ id: number; slug: string }> {
	const resp = await request.get("/api/posts?limit=1");
	expect(resp.status()).toBe(200);
	return ((await resp.json()) as { items: Array<{ id: number; slug: string }> }).items[0];
}

async function registerReader(
	request: import("@playwright/test").APIRequestContext,
	email: string,
): Promise<string> {
	const reg = await request.post("/api/reader/register", {
		data: { email, password: PASSWORD, display_name: "Delete E2E" },
	});
	expect(reg.status()).toBe(201);
	const login = await request.post("/api/reader/login", { data: { email, password: PASSWORD } });
	expect(login.status()).toBe(200);
	return (await login.json()).access_token as string;
}

test.describe("Reader account deletion (DEC-106)", () => {
	test("deleting the account anonymizes the reader's comment and removes login", async ({
		page,
		request,
	}) => {
		const post = await firstPost(request);
		const email = freshEmail();
		const token = await registerReader(request, email);

		// Post a reader-attributed comment and approve it so it's public.
		const created = await request.post(`/api/comments/post/${post.id}`, {
			data: { nickname: "x", email: "x@x.com", content: "account deletion e2e" },
			headers: { Authorization: `Bearer ${token}` },
		});
		expect(created.status()).toBe(201);
		const commentId = (await created.json()).id as number;
		const admin = await request.post("/api/admin/login", {
			form: { username: "admin", password: "admin123" },
		});
		await request.patch(`/api/comments/${commentId}/approve`, {
			data: { approved: true },
			headers: { Authorization: `Bearer ${(await admin.json()).access_token}` },
		});

		// Sign in and open the account page.
		await page.goto("/login");
		await page.locator('input[type="email"]').fill(email);
		await page.locator('input[type="password"]').fill(PASSWORD);
		await page.locator("form").press("Enter");
		await page.waitForURL("**/bookmarks");
		await page.goto("/account");

		const section = page.locator("section", { hasText: "删除账号" });
		page.once("dialog", (d) => d.accept());
		await section.locator('input[type="password"]').fill(PASSWORD);
		await section.locator("button", { hasText: "删除我的账号" }).click();

		// The reader token is cleared (logged out / redirected away).
		await expect.poll(() => page.evaluate(() => localStorage.getItem("reader_token"))).toBeNull();

		// The old token can no longer authenticate (account deleted).
		const me = await request.get("/api/reader/me", {
			headers: { Authorization: `Bearer ${token}` },
		});
		expect(me.status()).toBe(401);

		// The comment is still public but anonymized (reader is null).
		const listed = await request.get(`/api/comments/post/${post.id}`);
		const items = (await listed.json()) as Array<{ id: number; reader: unknown }>;
		const item = items.find((c) => c.id === commentId);
		expect(item).toBeDefined();
		expect(item?.reader).toBeNull();
	});
});
