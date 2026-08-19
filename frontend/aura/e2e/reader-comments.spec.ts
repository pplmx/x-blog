/**
 * Reader-attributed comments journey (DEC-062, TASK-135/136).
 *
 * A signed-in reader posting a comment does so under their verified account
 * identity: the form shows the identity (no nickname/email inputs) and the
 * backend stamps the account's display_name. The submitted client nickname is
 * ignored (no spoofing).
 */

import { expect, test } from "@playwright/test";

let emailCounter = 0;
function freshEmail(): string {
	emailCounter += 1;
	return `commenter-${Date.now()}-${emailCounter}@example.com`;
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

test.describe("Reader-attributed comments", () => {
	test("signed-in reader comments under their verified identity", async ({ page, request }) => {
		const email = freshEmail();
		await registerReader(request, email);

		// Open the first post (capture its href as a plain string — locators
		// re-resolve against the current page, and we navigate away for login).
		await page.goto("/");
		const postLink = page.locator("main a[href*='/posts/']").first();
		await postLink.waitFor({ state: "visible" });
		const postHref = (await postLink.getAttribute("href"))!;
		await page.goto(postHref);
		await page.locator("section").filter({ hasText: "评论" }).first().waitFor({ state: "visible" });

		// Sign in via the reader /login flow.
		await page.goto("/login");
		await page.locator('input[type="email"]').fill(email);
		await page.locator('input[type="password"]').fill(PASSWORD);
		await page.locator("form").press("Enter");
		// After login the default route is /bookmarks; navigate back to the post.
		await page.waitForURL("**/bookmarks");
		await page.goto(postHref);

		// The signed-in comment form shows the verified identity instead of the
		// nickname/email inputs (SSR renders the anonymous form first, so wait
		// for client hydration to flip the form to the reader identity).
		await expect(page.locator("#comment-content")).toBeVisible({ timeout: 10000 });
		await expect(page.locator("#reader-comment-identity")).toBeVisible({ timeout: 10000 });
		await expect(page.locator("#comment-nickname")).toHaveCount(0);
		await expect(page.locator("#comment-email")).toHaveCount(0);

		// Submit a comment; it's pending moderation but recorded with our identity.
		await page.locator("#comment-content").fill("A verified reader comment");
		await page.locator("button[type='submit']").first().click();
		await expect(page.locator("text=评论提交成功，等待审核中！")).toBeVisible({ timeout: 5000 });
	});
});
