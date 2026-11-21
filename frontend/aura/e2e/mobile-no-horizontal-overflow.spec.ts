/**
 * No horizontal page scroll on phones.
 *
 * A single unshrinkable child widened the whole document: the guest
 * comment-follow form and the share-button row were the offenders, each
 * pushing every article past the viewport edge. Both 390px (iPhone 12–15) and
 * 320px (iPhone SE 1st gen / small Android) are checked because the narrowest
 * target is where fixed-width rows break first.
 */

import { expect, test } from "@playwright/test";

const ROUTES = [
	"/",
	"/posts/welcome-to-x-blog",
	"/archive",
	"/categories",
	"/series",
	"/comments",
];

for (const width of [320, 390]) {
	test.describe(`viewport ${width}px`, () => {
		test.use({ viewport: { width, height: 844 }, isMobile: true, hasTouch: true });

		for (const route of ROUTES) {
			test(`stays within the viewport: ${route}`, async ({ page }) => {
				await page.goto(route);
				await expect(page.locator("main")).toBeVisible();

				const widths = await page.evaluate(() => ({
					document: document.documentElement.scrollWidth,
					viewport: window.innerWidth,
				}));

				// 1px of rounding slack; anything wider means the page pans sideways.
				expect(
					widths.document,
					`${route} must not scroll horizontally at ${width}px`,
				).toBeLessThanOrEqual(widths.viewport + 1);
			});
		}
	});
}
