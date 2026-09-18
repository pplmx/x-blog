/**
 * Offline reading (round 384, service-worker runtime cache).
 *
 * The service worker is registered app-wide in the production build and
 * network-first caches successful same-origin GETs. Visiting a post caches
 * its document + JS/CSS chunks + images, so reloading it with the connection
 * off still renders the page. This spec: get a SW registered and controlling
 * the page, fully load a post and wait for its document to land in the
 * offline cache, drop the network, reload, and assert the article still
 * renders.
 */

import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

const OFFLINE_CACHE = "xblog-offline-v1";

/** Register + get the SW to control the page (the first install only starts
 * controlling after a reload). */
async function swControls(page: Page) {
	await page.goto("/");
	await page.waitForFunction(() => "serviceWorker" in navigator);
	if (!(await page.evaluate(() => Boolean(navigator.serviceWorker.controller)))) {
		await page.reload();
	}
	await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller), null, {
		timeout: 15000,
	});
}

test("renders a previously-visited post with the network offline", async ({ page, context }) => {
	await swControls(page);

	// Pick a post and fully load it (a real navigation, so its document flows
	// through the SW fetch handler and its path lands in the offline cache).
	const postLink = page.locator("main a[href*='/posts/']").first();
	await expect(postLink).toBeVisible({ timeout: 15000 });
	const postUrl = (await postLink.getAttribute("href")) as string;
	await page.goto(postUrl);
	await page.waitForURL("**/posts/**");

	const title = (await page.locator("h1").first().textContent())?.trim();

	// Wait until this document is actually in the SW's offline cache (the
	// network-first write is fire-and-forget).
	await page.waitForFunction(
		(cacheName) =>
			window.caches
				.open(cacheName)
				.then((cache) => cache.keys())
				.then((keys) => keys.some((k) => new URL(k.url).pathname === window.location.pathname)),
		OFFLINE_CACHE,
		{ timeout: 15000 },
	);

	// Drop the network and reload the same post: the SW must serve it from
	// cache (document + chunks), so the article still renders.
	await context.setOffline(true);
	try {
		await page.reload({ waitUntil: "domcontentloaded" });
		await expect(page.locator("h1").first()).toBeVisible({ timeout: 20000 });
		if (title) {
			await expect(page.locator("h1").first()).toContainText(title);
		}
	} finally {
		await context.setOffline(false);
	}
});
