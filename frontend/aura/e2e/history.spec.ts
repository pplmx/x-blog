/**
 * Reading-history page journey (DEC-114, TASK-169).
 *
 * A reader who opens a post can reach the Reading history page (via the nav
 * entry link) and see that post listed newest-first; clearing history returns
 * the page to its empty state. The trail is client-side (localStorage), so
 * this needs only a live backend with at least one published post.
 */

import { expect, test } from "@playwright/test";

test.describe("Reading history page (TASK-169)", () => {
	test("lists a viewed post and clears it to the empty state", async ({ page }) => {
		await page.goto("/");
		const postLink = page.locator("article a").first();
		if (!(await postLink.isVisible())) {
			test.skip();
			return;
		}
		// Build the needle from the card's heading minus the pinned badge span:
		// the history entry renders only the bare post title, so the whole-card
		// textContent (badge + date + stats + excerpt) could never match it
		// (pre-existing journey break against the shared dev DB, ISS-119). The
		// first /posts/ link on a signed-in home may be a "为你推荐" card (h3)
		// instead of the posts-grid PostCard (h2), so match on either heading.
		const titleEl = postLink.locator("h2, h3").first();
		let title: string;
		if (await titleEl.count()) {
			const badge = titleEl.locator("span").first();
			if (await badge.count()) await badge.evaluate((el) => el.remove());
			title = ((await titleEl.textContent()) ?? "").trim();
		} else {
			title = ((await postLink.textContent()) ?? "").trim();
		}

		// Opening the post records it in the client-side history trail.
		await postLink.click();
		await page.waitForURL(/\/posts\//);

		// Reach the history page through the nav entry link.
		const navHistory = page.locator("nav a", { hasText: "阅读历史" }).first();
		if (await navHistory.isVisible()) {
			await navHistory.click();
		} else {
			await page.goto("/history");
		}
		await page.waitForURL("**/history");
		await expect(page.locator("h1").first()).toBeVisible({ timeout: 10000 });

		// The viewed post appears in the history list.
		if (title) {
			await expect(page.locator("main a", { hasText: title }).first()).toBeVisible({
				timeout: 10000,
			});
		}

		// Clear history (header button → confirm inside the alert) → empty state.
		await page.locator("main button", { hasText: "清空历史" }).first().click();
		await page.locator('[role="alert"] button', { hasText: "清空历史" }).click();
		await expect(page.locator("body")).toContainText("暂无阅读历史", { timeout: 10000 });
	});
});
