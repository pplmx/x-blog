/**
 * Reader reading-density preference (DEC-288, TASK-373).
 *
 * The A+/A− control on a post page scales the article body text, persists per
 * device (localStorage), and a fresh document load applies the stored choice.
 * The scale factor lives as `--reader-density` on <html>, so the assertions
 * read it from document.documentElement and from the computed body font-size
 * (not from a component style attribute, whose SSR/hydration reconcile the
 * composable deliberately does not rely on).
 */

import { expect, test } from "@playwright/test";

const rootVar = (
	page: import("@playwright/test").Page,
) => page.evaluate(() => document.documentElement.style.getPropertyValue("--reader-density"));

/** Open the first published post from the homepage grid. */
async function openFirstPost(page: import("@playwright/test").Page): Promise<string> {
	await page.goto("/");
	const postLink = page.locator("main a[href*='/posts/']").first();
	await postLink.waitFor({ state: "visible" });
	const href = (await postLink.getAttribute("href")) ?? "";
	await page.goto(href);
	const prose = page.locator(".prose-config");
	await expect(prose).toBeVisible();
	return href;
}

function bodyFontSize(page: import("@playwright/test").Page) {
	return page.locator(".prose-config p").first().evaluate(
		(el) => Number.parseFloat(getComputedStyle(el as HTMLElement).fontSize),
	);
}

/** Clear a stored preference exactly once per test (survives reloads). */
async function clearPreferenceOnce(page: import("@playwright/test").Page): Promise<void> {
	await page.addInitScript(() => {
		if (!sessionStorage.getItem("density-cleared")) {
			localStorage.removeItem("xblog_reading_density");
			sessionStorage.setItem("density-cleared", "1");
		}
	});
}

test.describe("Reading density (TASK-373)", () => {
	test("A+ grows the body text, persists, and re-applies on a fresh load", async ({ page }) => {
		await clearPreferenceOnce(page);
		const href = await openFirstPost(page);
		const body = page.locator(".prose-config p").first();
		await expect(body).toBeVisible();
		const before = await bodyFontSize(page);

		// A+ pushes the root var and grows the rendered body text.
		await page.locator('button[aria-label="增大字号"]').click();
		await expect.poll(() => rootVar(page)).toBe("1.1875");
		await expect.poll(() => bodyFontSize(page)).toBeGreaterThan(before);

		// The choice is persisted locally...
		await expect
			.poll(() => page.evaluate(() => localStorage.getItem("xblog_reading_density")))
			.toBe("1.1875");

		// ...and a fresh full document load re-applies it (the composable sets
		// the root var post-hydration; the body text is still larger).
		await page.goto(href);
		await expect.poll(() => rootVar(page), { timeout: 10_000 }).toBe("1.1875");
		await expect.poll(() => bodyFontSize(page)).toBeGreaterThan(before);

		// A− back to the default scale on the fresh document.
		await page.locator('button[aria-label="减小字号"]').click();
		await expect.poll(() => rootVar(page)).toBe("1");
	});

	test("A− is disabled at the smallest size (bound)", async ({ page }) => {
		await clearPreferenceOnce(page);
		await openFirstPost(page);
		const decrease = page.locator('button[aria-label="减小字号"]');

		// One click: md -> sm, which is the floor — A− is now disabled...
		await decrease.click();
		await expect(decrease).toBeDisabled();

		// ...but the other direction still works from the floor.
		const increase = page.locator('button[aria-label="增大字号"]');
		await increase.click();
		await expect(increase).toBeEnabled();
	});
});
