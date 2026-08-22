/**
 * Comment edit/delete by author journey (DEC-096, TASK-160).
 *
 * A signed-in reader sees Edit/Delete controls on their own approved comment,
 * can edit its text (an "edited" marker appears), and can delete it after a
 * confirmation dialog. The comment is seeded via the API with the reader's
 * token so it is reader-attributed and approved before the UI run.
 */

import { expect, test } from "@playwright/test";

const PASSWORD = "e2epass123";
let emailCounter = 0;
function freshEmail(): string {
	emailCounter += 1;
	return `editdeleter-${Date.now()}-${emailCounter}@example.com`;
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
		data: { email, password: PASSWORD, display_name: "E2E Editor" },
	});
	expect(reg.status()).toBe(201);
	const login = await request.post("/api/reader/login", {
		data: { email, password: PASSWORD },
	});
	expect(login.status()).toBe(200);
	return (await login.json()).access_token as string;
}

async function adminToken(request: import("@playwright/test").APIRequestContext): Promise<string> {
	const login = await request.post("/api/admin/login", {
		form: { username: "admin", password: "admin123" },
	});
	expect(login.status()).toBe(200);
	return (await login.json()).access_token as string;
}

async function postAndApproveReaderComment(
	request: import("@playwright/test").APIRequestContext,
	postId: number,
	readerToken: string,
	content: string,
): Promise<number> {
	const created = await request.post(`/api/comments/post/${postId}`, {
		data: { nickname: "x", email: "x@x.com", content },
		headers: { Authorization: `Bearer ${readerToken}` },
	});
	expect(created.status()).toBe(201);
	const commentId = (await created.json()).id as number;
	const approved = await request.patch(`/api/comments/${commentId}/approve`, {
		data: { approved: true },
		headers: { Authorization: `Bearer ${await adminToken(request)}` },
	});
	expect(approved.status()).toBe(200);
	return commentId;
}

async function logReaderIn(page: import("@playwright/test").Page, email: string) {
	await page.goto("/login");
	await page.locator('input[type="email"]').fill(email);
	await page.locator('input[type="password"]').fill(PASSWORD);
	await page.locator("form").press("Enter");
	await page.waitForURL("**/bookmarks");
}

test.describe("Comment edit/delete by author (DEC-096)", () => {
	test("a reader can edit and delete their own comment", async ({ page, request }) => {
		const post = await firstPost(request);
		const email = freshEmail();
		const readerToken = await registerReader(request, email);
		const stamp = Date.now();
		const original = `editable snippet ${stamp}`;
		const commentId = await postAndApproveReaderComment(request, post.id, readerToken, original);

		await logReaderIn(page, email);
		await page.goto(`/posts/${post.slug}`);
		const row = page.locator(`#comment-${commentId}`);
		await expect(row).toBeVisible({ timeout: 10000 });
		await expect(row.locator(".comment-edit")).toBeVisible();
		await expect(row.locator(".comment-delete")).toBeVisible();

		// --- Edit ---
		const editedText = `edited snippet ${stamp}`;
		await row.locator(".comment-edit").click();
		await row.locator("textarea").fill(editedText);
		await row.locator("button", { hasText: "保存" }).click();
		await expect(row).toContainText(editedText, { timeout: 10000 });
		await expect(row).toContainText("已编辑");

		// --- Delete (accept the confirm dialog) ---
		page.once("dialog", (d) => d.accept());
		await row.locator(".comment-delete").click();
		await expect(page.locator(`#comment-${commentId}`)).toHaveCount(0, { timeout: 10000 });
	});
});
