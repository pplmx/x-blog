/**
 * "My comments" reader journey (DEC-066, TASK-140).
 *
 * A signed-in reader: comments on a post, opens /comments, sees their comment
 * flagged "pending review"; an admin approves it and the badge flips to
 * "published"; deleting the comment empties the list. Verifies the moderation
 * status is author-visible (a moderated blog hides pending comments from the
 * public but not from their author) end-to-end.
 */

import { expect, test } from "@playwright/test";

let emailCounter = 0;
function freshEmail(): string {
	emailCounter += 1;
	return `mycomments-${Date.now()}-${emailCounter}@example.com`;
}
const PASSWORD = "e2epass123";
const DISPLAY_NAME = "E2E Commenter";

async function registerReader(
	request: import("@playwright/test").APIRequestContext,
	email: string,
) {
	const resp = await request.post("/api/reader/register", {
		data: { email, password: PASSWORD, display_name: DISPLAY_NAME },
	});
	expect(resp.status()).toBe(201);
}

async function adminApproveComment(
	request: import("@playwright/test").APIRequestContext,
	commentId: number,
) {
	const token = await adminToken(request);
	const resp = await request.patch(`/api/comments/${commentId}/approve`, {
		data: { approved: true },
		headers: { Authorization: `Bearer ${token}` },
	});
	expect(resp.status()).toBe(200);
}

test.describe("Reader my-comments journey", () => {
	test("reader sees moderation status and can delete their own comment", async ({
		page,
		request,
	}) => {
		const email = freshEmail();
		await registerReader(request, email);

		// Make the moderation state deterministic: verified-reader auto-approve
		// (DEC-098/101) is a runtime setting that admin-settings e2e runs leave
		// toggled either way in the shared DB — force it off so THIS reader's
		// comment always lands in the pending queue (pending badge is asserted).
		const autoApproveOff = await request.put("/api/admin/settings/auto_approve_reader_comments", {
			data: { value: "false" },
			headers: { Authorization: `Bearer ${await adminToken(request)}` },
		});
		expect(autoApproveOff.status()).toBe(200);

		// Comment on the first post as the signed-in reader.
		await page.goto("/");
		const postLink = page.locator("main a[href*='/posts/']").first();
		await postLink.waitFor({ state: "visible" });
		// Narrow the href before navigating — expect() documents the invariant
		// an archive-post always links to its own detail page instead of a `!`.
		await expect(postLink).toHaveAttribute("href", /\/posts\//);
		const postHref = (await postLink.getAttribute("href")) as string;
		await page.goto(postHref);
		await page.locator("section").filter({ hasText: "评论" }).first().waitFor({ state: "visible" });

		await page.goto("/login");
		await page.locator('input[type="email"]').fill(email);
		await page.locator('input[type="password"]').fill(PASSWORD);
		await page.locator("form").press("Enter");
		await page.waitForURL("**/bookmarks");
		await page.goto(postHref);
		await page.locator("#comment-content").fill("A pending comment from my-comments e2e");
		await page.locator("button[type='submit']").first().click();
		await expect(page.locator("text=评论提交成功，等待审核中！")).toBeVisible({ timeout: 5000 });

		// The comment id rides in the success response; grep it from the page
		// instead of relying on network ordering — capture the pending comment's
		// server id via the admin list after approval below.

		// Open /comments from the header nav: pending status is author-visible.
		await page
			.locator('header a[href="/comments"]')
			.first()
			.click()
			.catch(async () => {
				await page.goto("/comments");
			});
		await page.waitForURL("**/comments");
		await expect(page.locator("h1", { hasText: "我的评论" })).toBeVisible({ timeout: 10000 });
		// Target the per-comment pending badge by its tooltip title — a bare
		// text=待审核 ALSO matches the filter tab (strict-mode violation).
		await expect(page.getByTitle("评论正在等待管理员审核")).toBeVisible({ timeout: 10000 });
		await expect(page.locator("text=A pending comment from my-comments e2e")).toBeVisible();

		// Admin approves it -> status flips to 已发布.
		const adminComments = await request.get("/api/admin/comments", {
			headers: { Authorization: `Bearer ${await adminToken(request)}` },
		});
		expect(adminComments.status()).toBe(200);
		const all = (await adminComments.json()) as {
			items: Array<{ id: number; content: string }>;
		};
		const target = all.items.find((c) => c.content.includes("my-comments e2e"));
		expect(target).toBeTruthy();
		if (!target) throw new Error("pending comment not found in the admin list");
		await adminApproveComment(request, target.id);

		await page.reload();
		await expect(page.locator("text=已发布")).toBeVisible({ timeout: 10000 });

		// Deleting the comment empties the list.
		page.once("dialog", (d) => d.accept());
		await page.locator("button", { hasText: "删除" }).click();
		await expect(page.locator("text=还没有发表过评论")).toBeVisible({ timeout: 10000 });
	});
});

async function adminToken(request: import("@playwright/test").APIRequestContext) {
	const login = await request.post("/api/admin/login", {
		form: { username: "admin", password: "admin123" },
	});
	expect(login.status()).toBe(200);
	return (await login.json()).access_token as string;
}
