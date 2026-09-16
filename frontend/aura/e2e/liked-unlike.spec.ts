/**
 * Liked-posts in-place unlike journey (DEC-415, TASK-433).
 *
 * A signed-in reader with a liked post opens /liked and takes the like back
 * right from the card (the page's one management control): the card leaves the
 * grid, the count reflects it, and the post-page heart shows un-liked — no
 * need to visit the post to manage the "posts I appreciated" list.
 */

import { expect, test } from "@playwright/test";

const PASSWORD = "e2epass123";
let emailCounter = 0;
function freshEmail(): string {
	emailCounter += 1;
	return `likedunlike-${Date.now()}-${emailCounter}@example.com`;
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
		data: { email, password: PASSWORD, display_name: "Unlike E2E" },
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

test.describe("Liked posts unlike (DEC-415)", () => {
	test("taking a like back on /liked removes the card in place", async ({ page, request }) => {
		const email = freshEmail();
		const readerToken = await registerAndLoginReader(page, request, email);
		const postId = await firstPost(request);
		const like = await request.post(`/api/reader/me/likes/${postId}`, {
			headers: { Authorization: `Bearer ${readerToken}` },
		});
		expect(like.status()).toBe(201);

		await page.goto("/liked");
		// The like appears as a card on the /liked page.
		const card = page.locator("main a[href*='/posts/']").first();
		await expect(card).toBeVisible({ timeout: 10000 });
		const href = await card.getAttribute("href");
		const title = (await card.locator("h2").first().textContent())?.trim() ?? "";

		// Unlike right from the card.
		await page.getByRole("button", { name: "取消喜欢" }).click();
		// The card leaves the grid (and the empty state follows a single like).
		await expect(page.locator(`text=${title}`)).not.toBeVisible({ timeout: 10000 });

		// Where the like card used to be, the page's empty state now explains
		// that nothing is liked — the in-place unlike took effect.
		await expect(page.locator("text=你还没有喜欢过任何文章")).toBeVisible({ timeout: 10000 });

		// The post page no longer shows the reader as having liked it (the
		// local marker was cleared too, so the heart is back to un-liked).
		if (href) {
			await page.goto(href);
			await expect(page.locator("button[title='喜欢']").first()).toBeVisible({ timeout: 10000 });
		}
	});
});
