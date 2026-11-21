/**
 * Reduced-motion support.
 *
 * The global stylesheet must honour `prefers-reduced-motion: reduce`: smooth
 * scrolling off and transitions collapsed to ~0, while the default preference
 * keeps the site's existing smooth scrolling.
 */

import { expect, test } from "@playwright/test";

test.describe("prefers-reduced-motion", () => {
	test("collapses scrolling and transitions when reduce is requested", async ({ page }) => {
		await page.emulateMedia({ reducedMotion: "reduce" });
		await page.goto("/");
		await expect(page.locator("header")).toBeVisible();

		const styles = await page.evaluate(() => {
			const html = getComputedStyle(document.documentElement);
			const body = getComputedStyle(document.body);
			return {
				scrollBehavior: html.scrollBehavior,
				durations: body.transitionDuration
					.split(",")
					.map((value) => Number.parseFloat(value))
					.filter(Number.isFinite),
			};
		});

		expect(styles.scrollBehavior).toBe("auto");
		expect(styles.durations.length).toBeGreaterThan(0);
		expect(Math.max(...styles.durations)).toBeLessThanOrEqual(0.01);
	});

	test("keeps smooth scrolling by default", async ({ page }) => {
		await page.emulateMedia({ reducedMotion: "no-preference" });
		await page.goto("/");
		const scrollBehavior = await page.evaluate(
			() => getComputedStyle(document.documentElement).scrollBehavior,
		);
		expect(scrollBehavior).toBe("smooth");
	});
});
