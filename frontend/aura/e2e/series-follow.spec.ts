/**
 * Series 'new part' follow journey (DEC-132, TASK-178).
 *
 * A signed-in reader can follow a series on its page to be pushed a
 * notification when a new part is published. The toggle is visible only to
 * signed-in readers; following persists (it is listed by the reader's
 * /me/series-follows) and unfollow removes it. Guests see no toggle.
 */

import { expect, test } from "@playwright/test";

const PASSWORD = "e2epass123";
let emailCounter = 0;
function freshEmail(): string {
	emailCounter += 1;
	return `follow-${Date.now()}-${emailCounter}@example.com`;
}

function tokenHeader(token: string): Record<string, string> {
	return { Authorization: `Bearer ${token}` };
}

test.describe("Series new-part follow (TASK-178)", () => {
	test("guests see no follow toggle on a series page", async ({ page, request }) => {
		const series = await request.get("/api/series");
		expect(series.status()).toBe(200);
		const list = (await series.json()) as Array<{ slug: string }>;
		if (!list.length) {
			test.skip();
			return;
		}
		await page.goto(`/series/${list[0].slug}`);
		await expect(page.locator("body")).toContainText("系列", { timeout: 10000 });
		await expect(page.getByRole("button", { name: /通知|follow/i })).toHaveCount(0);
	});

	test("signed-in reader follows, persists, and unfollows", async ({ page, request }) => {
		const series = await request.get("/api/series");
		expect(series.status()).toBe(200);
		const list = (await series.json()) as Array<{ id: number; slug: string }>;
		if (!list.length) {
			test.skip();
			return;
		}
		const target = list[0];

		// Register a reader and sign the app in.
		const email = freshEmail();
		const reg = await request.post("/api/reader/register", {
			data: { email, password: PASSWORD, display_name: "Follow E2E" },
		});
		expect(reg.status()).toBe(201);
		const token = ((await reg.json()) as { access_token: string }).access_token;
		await page.addInitScript((tk) => localStorage.setItem("reader_token", tk), token);

		await page.goto(`/series/${target.slug}`);
		const toggle = page.getByRole("button", { name: /有新篇时通知我/ });
		await expect(toggle).toBeVisible({ timeout: 10000 });

		// Follow -> state flips to "following".
		await toggle.click();
		await expect(page.getByRole("button", { name: /已关注新篇/ })).toBeVisible();

		// The follow is listed by the reader's own series-follows API.
		const listed = await request.get("/api/reader/me/series-follows", {
			headers: tokenHeader(token),
		});
		expect(listed.status()).toBe(200);
		const follows = (await listed.json()) as { items: Array<{ id: number }> };
		expect(follows.items.map((f) => f.id)).toContain(target.id);

		// Reloading the page keeps the followed state.
		await page.reload();
		await expect(page.getByRole("button", { name: /已关注新篇/ })).toBeVisible();

		// Unfollow -> back to "not following"; not listed anymore.
		await page.getByRole("button", { name: /已关注新篇/ }).click();
		await expect(page.getByRole("button", { name: /有新篇时通知我/ })).toBeVisible();

		const after = await request.get("/api/reader/me/series-follows", {
			headers: tokenHeader(token),
		});
		const afterData = (await after.json()) as { items: Array<{ id: number }> };
		expect(afterData.items.map((f) => f.id)).not.toContain(target.id);
	});
});
