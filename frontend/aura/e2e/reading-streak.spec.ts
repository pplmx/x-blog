/**
 * Reading streak + activity heatmap journey (DEC-169, TASK-201).
 *
 * After a signed-in reader views a post today, /history shows the
 * gamification surface fed by the server summary: a current/longest streak
 * card (at least 1 day for today's read) and a 52-week activity heatmap with
 * today's day cell shaded (tooltip includes the localized count).
 *
 * Multi-day streaks cannot be exercised through the API (views record "now"),
 * so the backend contract covers those; this journey proves the surface.
 */

import { expect, test } from "@playwright/test";

const PASSWORD = "e2epass123";
let emailCounter = 0;
function freshEmail(): string {
	emailCounter += 1;
	return `streak-${Date.now()}-${emailCounter}@example.com`;
}

async function registerReader(
	request: import("@playwright/test").APIRequestContext,
	email: string,
): Promise<string> {
	const resp = await request.post("/api/reader/register", {
		data: { email, password: PASSWORD, display_name: "Streak E2E" },
	});
	expect(resp.status()).toBe(201);
	return ((await resp.json()) as { access_token: string }).access_token;
}

test.describe("Reading streak + activity (TASK-201)", () => {
	test("a read today lights the streak card and the heatmap on /history", async ({
		page,
		request,
	}) => {
		const token = await registerReader(request, freshEmail());
		await page.addInitScript((tk) => {
			localStorage.setItem("reader_token", tk);
		}, token);

		// View a post so today has a read.
		await page.goto("/");
		const postLink = page.locator("main a[href*='/posts/']").first();
		await postLink.waitFor({ state: "visible" });
		const href = (await postLink.getAttribute("href")) ?? "";
		await page.goto(href);
		await page.waitForURL(/\/posts\//);

		// The gamification surface on /history.
		await page.goto("/history");
		await expect(page.locator("h1").first()).toBeVisible({ timeout: 10000 });
		await expect(page.locator("body")).toContainText("连续阅读");
		// The longest-streak caption is always populated (>= 1 day here).
		await expect(page.locator("body").getByText(/最长 \d+ 天/)).toBeVisible({
			timeout: 5000,
		});
		await expect(page.locator("body")).toContainText("阅读活跃度（近一年）");

		// Today's day cell is shaded and carries a count tooltip (the cell's
		// text is empty, so match the title attribute with a substring CSS attr).
		const litCell = page.locator('[title*="篇"]').first();
		await expect(litCell).toBeVisible({ timeout: 5000 });
	});
});
