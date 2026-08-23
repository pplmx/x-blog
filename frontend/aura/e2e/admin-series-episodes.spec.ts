/**
 * Admin series episode management journey (DEC-146, TASK-185).
 *
 * An author opens a series in the admin, sees its episodes in order, and
 * reorders them; the new order is persisted (read back via the episodes API).
 */

import { expect, test } from "@playwright/test";

const stamp = Date.now();

test.describe("Admin series episode management (TASK-185)", () => {
	test("an auth reorders a series' episodes from the admin", async ({ page, request }) => {
		// Log in as admin and capture the token to seed a series via the API.
		await page.goto("/admin/login");
		await page.fill('input[type="text"]', "admin");
		await page.fill('input[type="password"]', "admin123");
		await page.click('button[type="submit"]');
		await page.waitForURL("**/admin/posts");
		const token = (await page.evaluate(() => localStorage.getItem("admin_token"))) ?? "";
		const headers = { Authorization: `Bearer ${token}` };

		const slug = `ep-${stamp}`;
		const series = await request.post("/api/series", {
			data: {
				title: `Ep Series ${stamp}`,
				slug,
				description: "e2e",
			},
			headers,
		});
		expect(series.status()).toBe(201);
		const seriesId = ((await series.json()) as { id: number }).id;

		const p1 = await request.post("/api/posts", {
			data: {
				title: "Episode One",
				slug: `${slug}-one`,
				content: "content",
				published: true,
				series_id: seriesId,
				series_order: 1,
			},
			headers,
		});
		expect(p1.status()).toBe(201);
		const p1Id = ((await p1.json()) as { id: number }).id;
		const p2 = await request.post("/api/posts", {
			data: {
				title: "Episode Two",
				slug: `${slug}-two`,
				content: "content",
				published: true,
				series_id: seriesId,
				series_order: 2,
			},
			headers,
		});
		expect(p2.status()).toBe(201);
		const p2Id = ((await p2.json()) as { id: number }).id;

		// Open the admin series page and expand the series' episodes.
		await page.goto("/admin/series");
		const card = page.locator("div", { hasText: `Ep Series ${stamp}` }).first();
		await expect(card.getByRole("button", { name: "章节" })).toBeVisible();
		await card.getByRole("button", { name: "章节" }).click();
		await expect(card).toContainText("Episode One", { timeout: 10000 });
		await expect(card).toContainText("Episode Two");

		// Move the first episode down; the reorder should persist.
		await card.getByRole("button", { name: "下移" }).click();
		await expect
			.poll(async () => {
				const res = await request.get(`/api/series/${seriesId}/episodes`, { headers });
				return ((await res.json()) as Array<{ id: number }>).map((e) => e.id);
			})
			.toEqual([p2Id, p1Id]);
	});
});
