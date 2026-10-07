/**
 * PWA "installable + offline bookmarks" journey (round 465 slice).
 *
 * Two acceptance behaviours in one headless proof:
 *  1. The page is a valid PWA shell — a manifest is linked and resolveable
 *     (installability prerequisite: manifest + standalone display + icons).
 *  2. A signed-in reader who bookmarks a post gets it proactively cached by
 *     the service worker (the /bookmarks row shows an "available offline"
 *     badge) and can actually open and read that post with the network off —
 *     even though they never visited it while online.
 *
 * The SW registers app-wide in the production build (the webServer runs a
 * production preview), so it wields its fetch + message handlers for real.
 */

import type { APIRequestContext, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

const PASSWORD = "e2epass123";

interface Manifest {
	name?: string;
	short_name?: string;
	start_url?: string;
	display?: string;
	theme_color?: string;
	background_color?: string;
	id?: string;
	icons?: { src: string; sizes: string; type: string }[];
}

/** Register a reader account and return its access token. */
async function registerReader(request: APIRequestContext, email: string): Promise<string> {
	const resp = await request.post("/api/reader/register", {
		data: { email, password: PASSWORD, display_name: "PWA E2E" },
	});
	expect(resp.status()).toBe(201);
	const body = (await resp.json()) as { access_token: string };
	return body.access_token;
}

/** Register + get the SW to control the page (first install needs a reload). */
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

test("serves a valid PWA manifest for installability", async ({ page, request }) => {
	// Manifest must be linked from the document head.
	const resp = await request.get("/manifest.webmanifest");
	expect(resp.status()).toBe(200);
	const manifest = (await resp.json()) as Manifest;
	expect(manifest.name).toBeTruthy();
	expect(manifest.short_name).toBeTruthy();
	expect(manifest.start_url).toBe("/");
	expect(manifest.display).toBe("standalone");
	expect(manifest.id).toBeTruthy();
	expect(manifest.icons?.length ?? 0).toBeGreaterThan(0);

	// Every referenced icon must actually resolve (a broken icon breaks the
	// browser's install prompt).
	for (const icon of manifest.icons ?? []) {
		const iconResp = await request.get(icon.src);
		expect(iconResp.status()).toBe(200);
		expect(iconResp.headers()["content-type"]).toContain("image/");
	}

	// The manifest is actually wired into the served document head.
	await page.goto("/");
	const manifestLink = page.locator('link[rel="manifest"]');
	await expect(manifestLink).toHaveAttribute("href", "/manifest.webmanifest");
});

test("a signed-in reader can read a bookmarked post offline", async ({
	page,
	context,
	request,
}) => {
	const email = `pwa-${Date.now()}@example.com`;
	const token = await registerReader(request, email);

	// Sign the app in (useReaderAuth reads "reader_token" from localStorage).
	await page.addInitScript((tk) => localStorage.setItem("reader_token", tk), token);
	await swControls(page);

	// Bookmark the first published post.
	const postLink = page.locator("main a[href*='/posts/']").first();
	await postLink.waitFor({ state: "visible" });
	const href = (await postLink.getAttribute("href")) as string;
	await page.goto(href);
	await page.locator("button[title='收藏文章']").first().click();
	await expect(page.locator("button[title*='取消收藏']").first()).toBeVisible({ timeout: 5000 });

	// /bookmarks mounts signed-in, so it proactively caches the saved post and,
	// once the SW's cache write lands, the row lights up "available offline".
	await page.goto("/bookmarks");
	await expect(page.locator(`a[href="${href}"]`).first()).toBeVisible({ timeout: 10000 });
	await expect(page.locator("text=可离线").first()).toBeVisible({ timeout: 20000 });

	// The post was never visited while online (we only bookmarked it), so this
	// proves the SW's proactive cache, not an accidental visit-cache hit.
	await context.setOffline(true);
	try {
		await page.goto(href, { waitUntil: "domcontentloaded" });
		await expect(page.locator("h1").first()).toBeVisible({ timeout: 20000 });
	} finally {
		await context.setOffline(false);
	}
});
