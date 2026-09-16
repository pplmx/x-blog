/**
 * Personalized "Recommended for you" on the post page (round 362, DEC-397).
 *
 * The homepage has the affinity-scored strip; the post page only had topic-
 * similar Related Posts. A signed-in reader who finishes an article should
 * get posts scored from THEIR reading history here too. Journey: a signed-in
 * reader reads a post (which records history → builds category affinity),
 * then opens a DIFFERENT post and the article-end strip appears with a
 * recommendation; a guest on the same page sees nothing.
 */

import { expect, test } from "@playwright/test";

let emailCounter = 0;
function freshEmail(): string {
	emailCounter += 1;
	return `recs-${Date.now()}-${emailCounter}@example.com`;
}
const PASSWORD = "e2epass123";

async function registerReader(
	request: import("@playwright/test").APIRequestContext,
	email: string,
): Promise<{ access_token: string; reader: Record<string, unknown> }> {
	const resp = await request.post("/api/reader/register", {
		data: { email, password: PASSWORD, display_name: "Recs Reader" },
	});
	expect(resp.status()).toBe(201);
	const body = (await resp.json()) as { access_token: string; reader: Record<string, unknown> };
	return { access_token: body.access_token, reader: body.reader };
}

// Seed the FULL session (token + profile) — useReaderAuth only reads the
// profile from localStorage, so a bare token leaves reader null.
async function signIn(
	page: import("@playwright/test").Page,
	session: { access_token: string; reader: Record<string, unknown> },
) {
	await page.addInitScript((s) => {
		localStorage.setItem("reader_token", s.access_token);
		localStorage.setItem("reader_profile", JSON.stringify(s.reader));
	}, session);
}

/** Open the first homepage post and read it (records history → affinity). */
async function readFirstPost(page: import("@playwright/test").Page): Promise<string> {
	await page.goto("/");
	const postLink = page.locator("main a[href*='/posts/']").first();
	await postLink.waitFor({ state: "visible" });
	const href = (await postLink.getAttribute("href")) as string;
	await page.goto(href);
	// Wait for the article to render so the history record has fired.
	await expect(page.locator("main article").first()).toBeVisible({ timeout: 5000 });
	return href;
}

test.describe("Post-page Recommended for you (DEC-397)", () => {
	test("a signed-in reader who read a post sees recommendations on a different post", async ({
		page,
		request,
	}) => {
		const session = await registerReader(request, freshEmail());
		await signIn(page, session);

		// Read one post → builds category affinity in reading history.
		const firstHref = await readFirstPost(page);
		// Open a second post; the affinity-scored strip should appear at the end.
		await page.goto("/");
		const links = page.locator("main a[href*='/posts/']");
		const secondHref =
			(await links.nth(1).getAttribute("href")) !== firstHref
				? ((await links.nth(1).getAttribute("href")) as string)
				: ((await links.nth(2).getAttribute("href")) as string);
		await page.goto(secondHref);
		await expect(page.locator("main article").first()).toBeVisible();

		// The personalized strip is present with at least one linked post.
		const strip = page.locator("section", { hasText: "猜你喜欢" }).first();
		await expect(strip).toBeVisible({ timeout: 8000 });
		await expect(strip.locator("a[href*='/posts/']").first()).toBeVisible();
	});

	test("a guest on the same post sees no personalized strip", async ({ page }) => {
		await page.goto("/");
		const postLink = page.locator("main a[href*='/posts/']").first();
		await postLink.waitFor({ state: "visible" });
		const href = (await postLink.getAttribute("href")) as string;
		await page.goto(href);
		await expect(page.locator("main article").first()).toBeVisible();
		await expect(page.locator("section", { hasText: "猜你喜欢" })).toHaveCount(0);
	});
});
