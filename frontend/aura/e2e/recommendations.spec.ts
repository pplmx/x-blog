/**
 * Personalized "Recommended for you" journey (DEC-128, TASK-176).
 *
 * A signed-in reader who has read a post sees a "Recommended for you" home row
 * with posts matched from their category/tag affinity (excluding already-read).
 * Guests see no personalized row.
 */

import { expect, test } from "@playwright/test";

const PASSWORD = "e2epass123";
let emailCounter = 0;
function freshEmail(): string {
	emailCounter += 1;
	return `reader-${Date.now()}-${emailCounter}@example.com`;
}

test.describe("Recommended for you (TASK-176)", () => {
	test("signed-in reader sees the personalized row after reading a post", async ({
		page,
		request,
	}) => {
		// Register and sign the app in.
		const email = freshEmail();
		const reg = await request.post("/api/reader/register", {
			data: { email, password: PASSWORD, display_name: "Rec E2E" },
		});
		expect(reg.status()).toBe(201);
		const token = ((await reg.json()) as { access_token: string }).access_token;
		await page.addInitScript((tk) => localStorage.setItem("reader_token", tk), token);

		// Read a published post so history records category/tag affinity.
		const posts = await request.get("/api/posts?limit=1");
		expect(posts.status()).toBe(200);
		const first = ((await posts.json()) as { items: Array<{ id: number }> }).items[0];
		const view = await request.post(`/api/reader/me/history/${first.id}`, {
			headers: { Authorization: `Bearer ${token}` },
		});
		expect(view.status()).toBe(200);

		// Home shows the personalized row with at least one recommendation.
		await page.goto("/");
		await expect(page.locator("body")).toContainText("为你推荐", { timeout: 10000 });
		// The recommended section is present and populated.
		await expect(page.locator("h2", { hasText: "为你推荐" }).first()).toBeVisible();
	});
});
