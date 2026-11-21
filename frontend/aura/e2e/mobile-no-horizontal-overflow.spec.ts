/**
 * No horizontal page scroll on phones.
 *
 * A single unshrinkable child (the guest comment-follow form was the offender)
 * widened the whole document on a 390px viewport, so every article could be
 * panned sideways. These routes are the ones that carry the widest fixed-width
 * content: the article body (tables, code), the comment header form, and the
 * list pages' filter rows.
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

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

for (const route of ROUTES) {
	test(`stays within the viewport at 390px: ${route}`, async ({ page }) => {
		await page.goto(route);
		await expect(page.locator("main")).toBeVisible();

		const widths = await page.evaluate(() => ({
			document: document.documentElement.scrollWidth,
			viewport: window.innerWidth,
		}));

		// 1px of rounding slack; anything wider means the page pans sideways.
		expect(widths.document, `${route} must not scroll horizontally`).toBeLessThanOrEqual(
			widths.viewport + 1,
		);
	});
}
