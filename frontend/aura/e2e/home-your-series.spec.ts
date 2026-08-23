/**
 * Home "Your series" row journey (DEC-136, TASK-180).
 *
 * A signed-in reader who follows a series sees it in a personalized "Your
 * series" row on the home page with a link back into the series (guests see no
 * row). When they have started reading, the row resolves per-series progress.
 */

import { expect, test } from "@playwright/test";

const PASSWORD = "e2epass123";
let emailCounter = 0;
function freshEmail(): string {
	emailCounter += 1;
	return `your-series-${Date.now()}-${emailCounter}@example.com`;
}

function tokenHeader(token: string): Record<string, string> {
	return { Authorization: `Bearer ${token}` };
}

test.describe("Home 'Your series' row (TASK-180)", () => {
	test("guests see no Your-series row", async ({ page }) => {
		await page.goto("/");
		await expect(page.locator("section", { hasText: "我的系列" })).toHaveCount(0);
	});

	test("a signed-in reader who follows a series sees it in the row", async ({ page, request }) => {
		const list = await request.get("/api/series");
		expect(list.status()).toBe(200);
		const seriesList = (await list.json()) as Array<{ id: number; slug: string }>;
		if (!seriesList.length) {
			test.skip();
			return;
		}
		const target = seriesList[0];

		// Register a reader and sign the app in.
		const email = freshEmail();
		const reg = await request.post("/api/reader/register", {
			data: { email, password: PASSWORD, display_name: "Your Series E2E" },
		});
		expect(reg.status()).toBe(201);
		const token = ((await reg.json()) as { access_token: string }).access_token;
		await page.addInitScript((tk) => localStorage.setItem("reader_token", tk), token);

		// Follow the series, and read one of its parts if it has any, so the row
		// can show reading progress.
		const follow = await request.put(`/api/reader/me/series/${target.id}/follow`, {
			headers: tokenHeader(token),
		});
		expect(follow.status()).toBe(201);

		const detail = (await (await request.get(`/api/series/${target.slug}`)).json()) as {
			posts?: Array<{ id: number }>;
		};
		if (detail.posts?.length) {
			const view = await request.post(`/api/reader/me/history/${detail.posts[0].id}`, {
				headers: tokenHeader(token),
			});
			expect(view.status()).toBe(200);
		}

		// The home page shows the followed series in the Your-series row.
		await page.goto("/");
		const row = page.locator("section", { hasText: "我的系列" });
		await expect(row).toBeVisible({ timeout: 10000 });
		await expect(row.locator(`a[href="/series/${target.slug}"]`).first()).toBeVisible();
	});
});
