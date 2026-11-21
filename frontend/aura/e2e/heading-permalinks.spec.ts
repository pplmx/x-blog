/**
 * Heading permalinks.
 *
 * Every markdown heading with an id gets a quiet "#" anchor. Activating it
 * updates the URL hash and lands the section below the sticky header.
 */

import { expect, test } from "@playwright/test";

test.describe("Heading permalinks", () => {
	test("a section anchor updates the hash and scrolls the heading into view", async ({
		page,
		request,
	}) => {
		const resp = await request.get("/api/posts?limit=1");
		expect(resp.status()).toBe(200);
		const body = (await resp.json()) as { items: Array<{ slug: string }> };
		const post = body.items[0];

		await page.goto(`/posts/${post.slug}`);
		const heading = page.locator(".markdown-content h2[id]").first();
		await expect(heading).toBeVisible();
		const id = await heading.getAttribute("id");
		expect(id).toBeTruthy();

		const anchor = heading.locator("a.heading-anchor");
		await expect(anchor).toHaveAttribute("href", `#${id}`);
		await expect(anchor).toHaveAccessibleName("链接到本节");

		// The anchor stays invisible until the heading is hovered.
		await expect(anchor).toHaveCSS("opacity", "0");
		await heading.hover();
		await expect(anchor).toHaveCSS("opacity", "1");

		await anchor.click();
		await expect(page).toHaveURL(new RegExp(`#${encodeURIComponent(id as string)}`));
		const top = await heading.evaluate((el) => el.getBoundingClientRect().top);
		// Sticky header is 64px tall; scroll-mt-24 (96px) keeps the title clear.
		expect(top).toBeGreaterThanOrEqual(64);
	});
});
