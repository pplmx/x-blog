/**
 * Reader cloud-synced likes journey (round 359, DEC-391/TASK-421).
 *
 * Exercises the end-to-end "posts I appreciated" story through the same-origin
 * frontend proxy: a guest like is promoted to a durable cloud row on sign-in
 * (the login merge), a signed-in reader's like button is a real toggle that
 * mirrors to the cloud and un-likes (decrementing the count), and the /liked
 * page lists the liked posts (merge-on-mount pulls the server set down). The
 * wall-clock mirror lets a brand-new reader like from /liked's own seed path.
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
		data: { email, password: PASSWORD, display_name: "Likes E2E" },
	});
	expect(resp.status()).toBe(201);
	return (await resp.json()) as { access_token: string; reader: { id: number; email: string } };
}

/** Open the first published post page and return its href. */
async function openFirstPost(page: import("@playwright/test").Page): Promise<string> {
	await page.goto("/");
	const postLink = page.locator("main a[href*='/posts/']").first();
	await postLink.waitFor({ state: "visible" });
	await expect(postLink).toHaveAttribute("href", /\/posts\//);
	const href = (await postLink.getAttribute("href")) as string;
	await page.goto(href);
	return href;
}

test.describe("Reader cloud-synced likes", () => {
	test("guest like → sign in → the like becomes a durable cloud row on /liked", async ({
		page,
		request,
	}) => {
		const email = freshEmail();
		await registerReader(request, email);

		// Like a post while logged out (localStorage marker only).
		const href = await openFirstPost(page);
		await page.locator("button[title='喜欢']").first().click();
		await expect(page.locator("button[title='已点赞']").first()).toBeVisible({ timeout: 5000 });

		// Sign in via the reader /login page — the login merge pushes the guest
		// like up as a real cloud row and merges the server set down. Scope the
		// email/password fields to <main>: the layout footer's newsletter form
		// also has a type="email" input, so a bare input[type=email] strict-mode
		// resolves 2 elements.
		await page.goto("/login");
		await page.locator("main input[type='email']").fill(email);
		await page.locator("main input[type='password']").fill(PASSWORD);
		await page.locator("main form").press("Enter");
		await page.waitForURL("**/bookmarks");

		// The promoted like shows on /liked for this reader.
		await page.goto("/liked");
		await expect(page.locator("h1")).toContainText("喜欢的文章");
		await expect(page.locator(`a[href="${href}"]`).first()).toBeVisible({ timeout: 10000 });
	});

	test("signed-in like is a toggle: like bumps the count, unlike removes + decrements", async ({
		page,
		request,
	}) => {
		const { access_token } = await registerReader(request, freshEmail());
		// Sign the app in directly (useReaderAuth reads "reader_token" from
		// localStorage) — the UI login merge is covered by the test above.
		await page.addInitScript((tk) => {
			localStorage.setItem("reader_token", tk);
		}, access_token);

		const href = await openFirstPost(page);
		const likeBtn = page.locator("button[title='喜欢']").first();
		await expect(likeBtn).toBeVisible({ timeout: 5000 });
		const before = Number((await likeBtn.textContent())?.trim() ?? "0");
		await likeBtn.click();

		// Toggled to the liked state (title flips) and the count went up.
		const likedBtn = page.locator("button[title='已点赞']").first();
		await expect(likedBtn).toBeVisible({ timeout: 5000 });
		await expect(likedBtn).toHaveText(String(before + 1), { timeout: 5000 });

		// /liked lists the liked post (merge-on-mount pulls the server set).
		await page.goto("/liked");
		await expect(page.locator("h1")).toContainText("喜欢的文章");
		await expect(page.locator(`a[href="${href}"]`).first()).toBeVisible({ timeout: 10000 });

		// Unlike on the post page: the toggle flips back and the count drops.
		await page.goto(href);
		const nowLiked = page.locator("button[title='已点赞']").first();
		await expect(nowLiked).toBeVisible({ timeout: 5000 });
		await expect(nowLiked).toHaveText(String(before + 1), { timeout: 5000 });
		await nowLiked.click();
		await expect(page.locator("button[title='喜欢']").first()).toBeVisible({ timeout: 5000 });

		// /liked is back to its empty state for this reader.
		await page.goto("/liked");
		await expect(page.locator("h1")).toContainText("喜欢的文章");
		await expect(page.locator(`a[href="${href}"]`).first()).toHaveCount(0);
		await expect(page.getByText("你还没有喜欢过任何文章")).toBeVisible({ timeout: 10000 });
	});
});
