/**
 * Series reading-progress journey (DEC-122, TASK-173).
 *
 * A signed-in reader sees a per-series progress card on the series page,
 * derived from their reading history: once they read one episode, the read
 * count / progress bar update and a continue link points at the next unread
 * episode. Guests see no progress.
 */

import { expect, test } from "@playwright/test";

const PASSWORD = "e2epass123";
let emailCounter = 0;
function freshEmail(): string {
	emailCounter += 1;
	return `reader-${Date.now()}-${emailCounter}@example.com`;
}

test.describe("Series reading progress (TASK-173)", () => {
	test("signed-in reader sees progress after reading an episode", async ({ page, request }) => {
		// Pick a series with at least one published post.
		const seriesResp = await request.get("/api/series");
		expect(seriesResp.status()).toBe(200);
		const seriesList = (await seriesResp.json()) as Array<{ slug: string }>;
		if (!seriesList.length) {
			test.skip();
			return;
		}
		const detailResp = await request.get(`/api/series/${seriesList[0].slug}`);
		const detail = (await detailResp.json()) as {
			slug: string;
			posts: Array<{ id: number }>;
		};
		if (!detail.posts?.length) {
			test.skip();
			return;
		}

		// Register a reader and sign the app in.
		const email = freshEmail();
		const reg = await request.post("/api/reader/register", {
			data: { email, password: PASSWORD, display_name: "Progress E2E" },
		});
		expect(reg.status()).toBe(201);
		const token = ((await reg.json()) as { access_token: string }).access_token;
		await page.addInitScript((tk) => localStorage.setItem("reader_token", tk), token);

		// Read the first episode so history records it.
		const view = await request.post(`/api/reader/me/history/${detail.posts[0].id}`, {
			headers: { Authorization: `Bearer ${token}` },
		});
		expect(view.status()).toBe(200);

		// The series page shows a progress card with a read count + continue link.
		await page.goto(`/series/${detail.slug}`);
		await expect(page.locator("body")).toContainText("阅读进度", { timeout: 10000 });
		await expect(page.locator("body")).toContainText(`已读 1 / ${detail.posts.length}`);
		await expect(page.locator("a", { hasText: "继续阅读" }).first()).toBeVisible();
	});
});
