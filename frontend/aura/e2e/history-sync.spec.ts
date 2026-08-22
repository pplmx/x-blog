/**
 * Server-backed reading-history sync journey (DEC-116, TASK-170).
 *
 * A signed-in reader's viewed posts persist server-side (keyed to their
 * account), so the Continue-reading trail on /history reflects what they read
 * on this device and will follow them across devices. Guest visits keep the
 * local localStorage trail (covered by e2e/history.spec.ts).
 *
 * This spec sets the reader token in localStorage to put the app in the
 * signed-in state, opens a post (which records the view server-side), then
 * verifies /history lists it from the API and that clearing empties it.
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
		data: { email, password: PASSWORD, display_name: "History E2E" },
	});
	expect(resp.status()).toBe(201);
	return ((await resp.json()) as { access_token: string }).access_token;
}

test.describe("Server-backed reading history (TASK-170)", () => {
	test("signed-in reader's viewed post is served from the API on /history and clears", async ({
		page,
		request,
	}) => {
		const email = freshEmail();
		const token = await registerReader(request, email);

		// Sign the app in by seeding the reader token (useReaderAuth reads
		// "reader_token" from localStorage on the client).
		await page.addInitScript((tk) => {
			localStorage.setItem("reader_token", tk);
		}, token);

		// Open the first published post — this records the view server-side.
		await page.goto("/");
		const postLink = page.locator("main a[href*='/posts/']").first();
		await postLink.waitFor({ state: "visible" });
		const href = (await postLink.getAttribute("href")) ?? "";
		const title = (await postLink.textContent()) ?? "";
		await page.goto(href);
		await page.waitForURL(/\/posts\//);

		// The history page lists the post from the server trail.
		await page.goto("/history");
		await expect(page.locator("h1").first()).toBeVisible({ timeout: 10000 });
		if (title) {
			await expect(page.locator("main a", { hasText: title.trim() }).first()).toBeVisible({
				timeout: 10000,
			});
		}

		// The reading-summary card reflects the server-backed stats (TASK-171).
		await expect(page.locator("body")).toContainText("已读文章", { timeout: 10000 });

		// The API itself returns the recorded view for this reader.
		const api = await request.get("/api/reader/me/history", {
			headers: { Authorization: `Bearer ${token}` },
		});
		expect(api.status()).toBe(200);
		expect((await api.json()).total).toBeGreaterThan(0);

		// Clear via the UI → empty state, and the API list is emptied too.
		await page.locator("main button", { hasText: "清空历史" }).first().click();
		await page.locator('[role="alert"] button', { hasText: "清空历史" }).click();
		await expect(page.locator("body")).toContainText("暂无阅读历史", { timeout: 10000 });

		const after = await request.get("/api/reader/me/history", {
			headers: { Authorization: `Bearer ${token}` },
		});
		expect((await after.json()).total).toBe(0);
	});
});
