/**
 * Follow analytics journey (DEC-144, TASK-184).
 *
 * The operator (admin) sees how many readers follow each series and category on
 * the dashboard. We seed a reader follow and assert the dashboard surface shows
 * it (tracking-based, so it appears regardless of notification settings).
 */

import { expect, test } from "@playwright/test";

const PASSWORD = "e2epass123";
let emailCounter = 0;
function freshEmail(): string {
	emailCounter += 1;
	return `follow-stats-${Date.now()}-${emailCounter}@example.com`;
}

function tokenHeader(token: string): Record<string, string> {
	return { Authorization: `Bearer ${token}` };
}

test.describe("Admin follow analytics (TASK-184)", () => {
	test("dashboard shows followed series/categories to the operator", async ({ page, request }) => {
		// Log in as admin first.
		await page.goto("/admin/login");
		await page.fill('input[type="text"]', "admin");
		await page.fill('input[type="password"]', "admin123");
		await page.click('button[type="submit"]');
		await page.waitForURL("**/admin/posts");

		// Seed a reader follow on one category and one series (if any exist).
		const cats = await request.get("/api/categories");
		const catList =
			cats.status() === 200 ? ((await cats.json()) as Array<{ id: number; name: string }>) : [];
		const series = await request.get("/api/series");
		const seriesList =
			series.status() === 200
				? ((await series.json()) as Array<{ id: number; title: string }>)
				: [];
		if (!catList.length && !seriesList.length) {
			test.skip();
			return;
		}

		const email = freshEmail();
		const reg = await request.post("/api/reader/register", {
			data: { email, password: PASSWORD, display_name: "Follow Stats E2E" },
		});
		expect(reg.status()).toBe(201);
		const token = ((await reg.json()) as { access_token: string }).access_token;
		const headers = tokenHeader(token);

		let expectedCategory: string | null = null;
		if (catList.length) {
			const follow = await request.put(`/api/reader/me/categories/${catList[0].id}/follow`, {
				headers,
			});
			expect(follow.status()).toBe(201);
			expectedCategory = catList[0].name;
		}
		let expectedSeries: string | null = null;
		if (seriesList.length) {
			const follow = await request.put(`/api/reader/me/series/${seriesList[0].id}/follow`, {
				headers,
			});
			expect(follow.status()).toBe(201);
			expectedSeries = seriesList[0].title;
		}

		// Open the dashboard and confirm the follow-analytics surface.
		await page.goto("/admin");
		const followsCard = page.locator("div", { hasText: "读者关注" }).first();
		await expect(followsCard).toBeVisible({ timeout: 10000 });
		if (expectedCategory) {
			await expect(followsCard).toContainText(expectedCategory);
		}
		if (expectedSeries) {
			await expect(followsCard).toContainText(expectedSeries);
		}
	});
});
