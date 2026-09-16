/**
 * Read-later vs Done bookmark queue journey (round 361, DEC-395).
 *
 * A saved post either lives in the To-read queue or is marked Done. A signed-in
 * reader opens /bookmarks, marks a post Done (pruning the queue), and the
 * All/To-read/Done chips slice the list accordingly — with the flip persisted
 * to the cloud so a reload keeps the queue state.
 */

import { expect, test } from "@playwright/test";

let emailCounter = 0;
function freshEmail(): string {
	emailCounter += 1;
	return `queue-${Date.now()}-${emailCounter}@example.com`;
}
const PASSWORD = "e2epass123";

async function registerReader(
	request: import("@playwright/test").APIRequestContext,
	email: string,
): Promise<{ access_token: string; reader: Record<string, unknown> }> {
	const resp = await request.post("/api/reader/register", {
		data: { email, password: PASSWORD, display_name: "Queue Reader" },
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

test.describe("Bookmarks To-read/Done queue (DEC-395)", () => {
	test("mark a bookmark Done → it leaves To-read and survives a reload in Done", async ({
		page,
		request,
	}) => {
		const session = await registerReader(request, freshEmail());
		await signIn(page, session);

		// Save two posts while signed in (cloud-mirrored).
		await page.goto("/");
		const postLinks = page.locator("main a[href*='/posts/']");
		const first = postLinks.first();
		await first.waitFor({ state: "visible" });
		const href1 = (await first.getAttribute("href")) as string;
		const href2 = (await postLinks.nth(1).getAttribute("href")) as string;
		await page.goto(href1);
		await page.locator("button[title='收藏文章']").first().click();
		await expect(page.locator("button[title='取消收藏']").first()).toBeVisible({ timeout: 5000 });
		await page.goto(href2);
		await page.locator("button[title='收藏文章']").first().click();
		await expect(page.locator("button[title='取消收藏']").first()).toBeVisible({ timeout: 5000 });

		// Open /bookmarks: the To-read chip counts both, Done counts none.
		await page.goto("/bookmarks");
		await expect(page.locator("h1")).toContainText("收藏的文章");
		const group = page.locator('[role="group"]');
		await expect(group.locator("button", { hasText: "待读" })).toContainText("(2)");
		await expect(group.locator("button", { hasText: "已读" })).toContainText("(0)");

		// Mark the first post Done via its row toggle.
		const firstCard = page.locator(`a[href='${href1}']`).locator("..").locator("..");
		await firstCard.locator("button[aria-label='标记为已读']").click();

		// The chips rebalance: To-read 1, Done 1, and a Done badge appears.
		await expect(group.locator("button", { hasText: "待读" })).toContainText("(1)");
		await expect(group.locator("button", { hasText: "已读" })).toContainText("(1)");
		await expect(page.locator(".bg-emerald-100")).toBeVisible();

		// Filter to To-read: only the second post remains.
		await group.locator("button", { hasText: "待读" }).click();
		await expect(page.locator(`a[href='${href1}']`)).not.toBeVisible();
		await expect(page.locator(`a[href='${href2}']`)).toBeVisible();

		// Filter to Done: only the first post remains (the queue was pruned).
		await group.locator("button", { hasText: "已读" }).click();
		await expect(page.locator(`a[href='${href1}']`)).toBeVisible();
		await expect(page.locator(`a[href='${href2}']`)).not.toBeVisible();

		// The state is cloud-persisted: a hard reload keeps it in Done.
		await page.reload();
		await expect(page.locator("h1")).toContainText("收藏的文章");
		await expect(group.locator("button", { hasText: "已读" })).toContainText("(1)");
		await expect(page.locator(".bg-emerald-100")).toBeVisible();
	});

	test("move a Done bookmark back to To-read restores it to the queue", async ({
		page,
		request,
	}) => {
		const session = await registerReader(request, freshEmail());
		await signIn(page, session);

		await page.goto("/");
		const postLink = page.locator("main a[href*='/posts/']").first();
		await postLink.waitFor({ state: "visible" });
		const href = (await postLink.getAttribute("href")) as string;
		await page.goto(href);
		await page.locator("button[title='收藏文章']").first().click();
		await expect(page.locator("button[title='取消收藏']").first()).toBeVisible({ timeout: 5000 });

		await page.goto("/bookmarks");
		const group = page.locator('[role="group"]');
		const firstCard = page.locator(`a[href='${href}']`).locator("..").locator("..");
		// Re-query the row's toggle fresh AFTER the mark-Done re-render settles,
		// so the flip-back click never targets a stale detached node (the row is
		// re-keyed by Vue once done flips and the button swaps its label).
		const markRead = firstCard.locator("button[aria-label='标记为已读']");
		await markRead.waitFor({ state: "visible" });
		await markRead.click();
		await expect(page.locator(".bg-emerald-100")).toBeVisible();
		await expect(group.locator("button", { hasText: "已读" })).toContainText("(1)");

		// Flip it back to To-read (fresh locator again).
		const backToRead = page
			.locator(`a[href='${href}']`)
			.locator("..")
			.locator("..")
			.locator("button[aria-label='移回待读']");
		await backToRead.waitFor({ state: "visible" });
		await backToRead.click();
		await expect(group.locator("button", { hasText: "待读" })).toContainText("(1)");
		await expect(group.locator("button", { hasText: "已读" })).toContainText("(0)");

		// The Done filter is now empty.
		await group.locator("button", { hasText: "已读" }).click();
		await expect(page.locator(`a[href='${href}']`)).not.toBeVisible();
	});
});
