/**
 * Conditional GET + cache-header workflow through the Nuxt origin
 * (RIL DEC-058 / TASK-130).
 *
 * The backend implements strong-ETag 304 + Cache-Control on cacheable public
 * endpoints (routers/conditional.py); these tests verify the observable
 * contract through the Nuxt edge (the origin feed readers and browsers hit):
 *  1. Feeds revalidate: 200 with ETag + Cache-Control, then If-None-Match
 *     yields a bodyless 304 (feed proxies forward conditional headers).
 *  2. Public JSON lists behave the same way, and Cache-Control matches the
 *     declared policy.
 *  3. Write-on-read responses (post detail carries live counters) are no-store.
 */

import { expect, test } from "@playwright/test";

const PUBLIC_CACHE_CONTROL = "public, max-age=60";

test("RSS feed revalidates through the proxy (200 -> 304)", async ({ page }) => {
	const first = await page.request.get("/rss/feed.xml");
	expect(first.status()).toBe(200);
	const etag = first.headers().etag;
	const cacheControl = first.headers()["cache-control"];
	expect(etag, "feed 200 must carry a strong ETag").toBeTruthy();
	expect(cacheControl).toContain("public");
	expect(cacheControl).toBe(PUBLIC_CACHE_CONTROL);

	const revalidated = await page.request.get("/rss/feed.xml", {
		headers: { "If-None-Match": etag },
	});
	expect(revalidated.status(), "matching If-None-Match must return 304").toBe(304);
	expect((await revalidated.body()).length).toBe(0);
});

test("public posts list is conditional; post detail is no-store", async ({ page }) => {
	const list = await page.request.get("/api/posts");
	expect(list.status()).toBe(200);
	const etag = list.headers().etag;
	expect(etag, "public list 200 must carry a strong ETag").toBeTruthy();
	expect(list.headers()["cache-control"]).toBe(PUBLIC_CACHE_CONTROL);

	const revalidated = await page.request.get("/api/posts", {
		headers: { "If-None-Match": etag },
	});
	expect(revalidated.status()).toBe(304);
	expect((await revalidated.body()).length).toBe(0);

	// The write-on-read detail carries live views/likes — never cacheable.
	const detail = await page.request.get("/api/posts/welcome-to-x-blog");
	expect(detail.status()).toBe(200);
	expect(detail.headers()["cache-control"]).toBe("no-store");
});
