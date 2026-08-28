/**
 * Reader account + cloud-synced bookmarks journey (DEC-059, TASK-131/133/134).
 *
 * Exercises the end-to-end reader story through the same-origin frontend proxy
 * (register → bookmark → sign in → bookmarks persist to the cloud → the
 * /bookmarks page reflects the merged list). Also verifies audience separation
 * at the API edges used by readers (a reader token must be rejected by admin).
 */

import { expect, test } from "@playwright/test";

let emailCounter = 0;
function freshEmail(): string {
	emailCounter += 1;
	return `reader-${Date.now()}-${emailCounter}@example.com`;
}
const PASSWORD = "e2epass123";

async function registerReader(
	request: import("@playwright/test").APIRequestContext,
	email: string,
) {
	const resp = await request.post("/api/reader/register", {
		data: { email, password: PASSWORD, display_name: "E2E Reader" },
	});
	expect(resp.status()).toBe(201);
	return (await resp.json()) as { access_token: string; reader: { id: number; email: string } };
}

/** Open the first published post page and bookmark it via its detail button. */
async function bookmarkFirstPost(page: import("@playwright/test").Page): Promise<string> {
	await page.goto("/");
	const postLink = page.locator("main a[href*='/posts/']").first();
	await postLink.waitFor({ state: "visible" });
	// Narrow the href instead of `!`: expect() documents that a post card
	// always links to its own detail page.
	await expect(postLink).toHaveAttribute("href", /\/posts\//);
	const href = (await postLink.getAttribute("href")) as string;
	await page.goto(href);
	await page.locator("button[title='收藏文章']").first().click();
	// Confirm it toggled to the "added" state.
	await expect(page.locator("button[title*='取消收藏']").first()).toBeVisible({ timeout: 5000 });
	return href;
}

test.describe("Reader accounts + cloud bookmarks", () => {
	test("register → bookmark → sign in → bookmarks persist (cloud sync)", async ({
		page,
		request,
	}) => {
		const email = freshEmail();
		await registerReader(request, email);

		// Bookmark a post while logged out (localStorage only).
		const href = await bookmarkFirstPost(page);

		// Sign in via the reader /login page.
		await page.goto("/login");
		await page.locator('input[type="email"]').fill(email);
		await page.locator('input[type="password"]').fill(PASSWORD);
		await page.locator("form").press("Enter");
		await page.waitForURL("**/bookmarks");

		// The local bookmark was pushed up and the cloud list shows it.
		await expect(page.locator("h1")).toContainText("收藏的文章");
		await expect(page.locator(`a[href="${href}"]`).first()).toBeVisible({ timeout: 5000 });
	});

	test("reader token cannot access admin API (audience separation)", async ({ request }) => {
		const email = freshEmail();
		const { access_token } = await registerReader(request, email);
		const resp = await request.get("/api/admin/me", {
			headers: { Authorization: `Bearer ${access_token}` },
		});
		expect(resp.status()).toBeGreaterThanOrEqual(401);
	});

	test("bookmark made while logged out appears on /bookmarks before and after sign-in", async ({
		page,
		request,
	}) => {
		const email = freshEmail();
		await registerReader(request, email);
		const href = await bookmarkFirstPost(page);

		// Local bookmark visible while logged out.
		await page.goto("/bookmarks");
		await expect(page.locator(`a[href="${href}"]`).first()).toBeVisible({ timeout: 5000 });

		// Sign in; mergeLocalToCloud keeps it (push + pull union).
		await page.goto("/login");
		await page.locator('input[type="email"]').fill(email);
		await page.locator('input[type="password"]').fill(PASSWORD);
		await page.locator("form").press("Enter");
		await page.waitForURL("**/bookmarks");
		await expect(page.locator(`a[href="${href}"]`).first()).toBeVisible({ timeout: 5000 });
	});
});
