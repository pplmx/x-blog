/**
 * Bookmark folders journey (DEC-120, TASK-172).
 *
 * A signed-in reader can create a folder, file a bookmarked post into it, and
 * filter the bookmarks page by that folder. Cover flows through the prompt
 * dialog (create folder) and the per-row folder select (assign/filter).
 * Guest visits keep the flat list (no folder bar).
 */

import { expect, test } from "@playwright/test";

const PASSWORD = "e2epass123";
let emailCounter = 0;
function freshEmail(): string {
	emailCounter += 1;
	return `reader-${Date.now()}-${emailCounter}@example.com`;
}

async function registerReader(
	request: import("@playwright/test").APIRequestContext,
	email: string,
): Promise<string> {
	const resp = await request.post("/api/reader/register", {
		data: { email, password: PASSWORD, display_name: "Folders E2E" },
	});
	expect(resp.status()).toBe(201);
	return ((await resp.json()) as { access_token: string }).access_token;
}

test.describe("Bookmark folders (TASK-172)", () => {
	test("create folder → file a bookmark → filter by folder", async ({ page, request }) => {
		const email = freshEmail();
		const token = await registerReader(request, email);

		// Sign the app in (useReaderAuth reads "reader_token" from localStorage).
		await page.addInitScript((tk) => {
			localStorage.setItem("reader_token", tk);
		}, token);

		// Bookmark the first published post.
		await page.goto("/");
		const postLink = page.locator("main a[href*='/posts/']").first();
		await postLink.waitFor({ state: "visible" });
		const href = (await postLink.getAttribute("href")) ?? "";
		await page.goto(href);
		await page.locator("button[title='收藏文章']").first().click();
		await expect(page.locator("button[title*='取消收藏']").first()).toBeVisible({ timeout: 5000 });

		// Open bookmarks: folder bar is visible for the signed-in reader.
		await page.goto("/bookmarks");
		await expect(page.locator("button", { hasText: "新建文件夹" }).first()).toBeVisible({
			timeout: 10000,
		});
		await expect(page.locator(`a[href="${href}"]`).first()).toBeVisible({ timeout: 10000 });

		// Create a folder through the prompt dialog.
		page.on("dialog", (d) => d.accept("Reading"));
		await page.locator("button", { hasText: "新建文件夹" }).first().click();
		await expect(page.locator("button", { hasText: /Reading/ }).first()).toBeVisible({
			timeout: 10000,
		});

		// File the bookmark into "Reading".
		const row = page
			.locator(`a[href="${href}"]`)
			.locator("xpath=ancestor::div[contains(@class,'border')][1]");
		await row.locator("select").selectOption({ label: "Reading" });

		// The folder chip shows a count of 1 and filtering keeps the bookmark.
		await expect(page.locator("button", { hasText: /Reading \(1\)/ }).first()).toBeVisible();
		await page
			.locator("button", { hasText: /Reading \(1\)/ })
			.first()
			.click();
		await expect(page.locator(`a[href="${href}"]`).first()).toBeVisible();

		// The API confirms the assignment server-side.
		const api = await request.get("/api/reader/me/bookmarks", {
			headers: { Authorization: `Bearer ${token}` },
		});
		const slug = href.replace(/^\/posts\//, "");
		const item = (
			(await api.json()) as { items: Array<{ slug: string; folder_id: number | null }> }
		).items.find((i) => i.slug === slug);
		expect(item?.folder_id).not.toBeNull();
	});
});
