/**
 * Service worker (DEC-055, TASK-118; offline reading, round 384).
 *
 * Registered at /sw.js by usePushSubscription (navigator.serviceWorker.register
 * with the default classic scope "/") and, since round 384, app-wide by the
 * client plugin for offline reading. Jobs:
 *
 *   - "push": the push service delivered a message the backend encrypted for
 *     this subscription; parse the JSON payload and show a notification.
 *   - "notificationclick": focus the already-open matching tab, else open it.
 *   - "fetch": network-first, bounded runtime cache of successful same-origin
 *     GET responses (HTML documents, /_nuxt assets, images). The cache only
 *     ever serves as an OFFLINE fallback — while online every request still
 *     hits the network, so nothing served is ever stale. Visiting a post
 *     caches its document + chunks + images, so reloading it later without a
 *     connection renders the page. API, admin and feed endpoints are never
 *     cached (auth-heavy, volatile, or cheap).
 *   - "message" (offline bookmarks slice): the signed-in reader asks the SW
 *     to proactively cache their saved posts into a dedicated bookmarks cache
 *     (post document + its assets), so a bookmarked post reads offline even if
 *     it was never visited; unsaving a post prunes it. Only cacheable public
 *     post paths are ever stored — admin/API/feed remain excluded.
 *
 * Kept dependency-free and self-contained (classic service workers cannot use
 * ES module import/export). The pure helpers here are exercised in vitest via
 * `tests/sw.spec.ts`, which loads this file with a fake `self`.
 */

/** Runtime offline cache: name + bounded entry count (LRU-ish via key order). */
const OFFLINE_CACHE_NAME = "xblog-offline-v1";
const OFFLINE_CACHE_MAX = 60;

/**
 * Dedicated cache for the signed-in reader's bookmarked posts (PWA offline
 * slice, round 465). Unlike the runtime cache — which only stores pages the
 * reader happened to visit — this cache is proactively populated with the
 * reader's saved posts (post document + its assets) so a bookmarked post is
 * readable even if it was never visited. A post is pruned the moment it is
 * un-bookmarked, so the reader's saved set (and only that set) is what stays
 * available offline. Also bounded (LRU-ish via key order) so a large library
 * can't grow without bound; the cap only risks the earliest bookmarks.
 */
const BOOKMARKS_CACHE_NAME = "xblog-bookmarks-v1";
const BOOKMARKS_CACHE_MAX = 200;

/** Parse the notification payload; malformed/empty payloads degrade to {}. */
function parsePushPayload(raw) {
	try {
		return raw ? JSON.parse(raw) : {};
	} catch {
		return {};
	}
}

/** Only allow same-site, non-protocol-relative paths as the click target. */
function normalizeClickUrl(data) {
	const url = data && typeof data.url === "string" ? data.url : "/";
	return url.startsWith("/") && !url.startsWith("//") ? url : "/";
}

/**
 * Whether a same-origin URL path belongs in any offline cache: outside the
 * API/admin/feed surface. Shared by the runtime fetch path and the bookmarks
 * precache so a single rule decides what may be stored offline — API JSON,
 * the admin console, and RSS/sitemap (auth-heavy, volatile, or cheap) are
 * never cached.
 */
function isCacheablePath(pathname) {
	if (pathname.startsWith("/api/") || pathname.startsWith("/admin")) return false;
	if (pathname.startsWith("/rss/") || pathname === "/feed.xml" || pathname === "/sitemap.xml") {
		return false;
	}
	return true;
}

/**
 * Whether a request belongs in an offline cache: a successful-able same-origin
 * GET outside the API/admin/feed surface. Everything else (POSTs, cross-origin,
 * API JSON, admin console, RSS/sitemap) passes straight through untouched.
 */
function isCacheableRequest(request) {
	if (request.method !== "GET" || request.mode === "no-cors") return false;
	let url;
	try {
		url = new URL(request.url);
	} catch {
		return false;
	}
	if (url.origin !== self.location.origin) return false;
	return isCacheablePath(url.pathname);
}

/**
 * Store a successful response in the bounded offline cache, evicting the
 * oldest entry when the cap is reached (cache.keys() returns insertion order,
 * so the first key is the oldest).
 */
async function cacheSuccessfulResponse(requestUrl, response) {
	if (!response?.ok) return;
	const cache = await self.caches.open(OFFLINE_CACHE_NAME);
	await cache.put(requestUrl, response.clone());
	const keys = await cache.keys();
	if (keys.length > OFFLINE_CACHE_MAX) {
		await cache.delete(keys[0].url);
	}
}

/**
 * Network-first with offline cache fallback. While online every request hits
 * the network (so the page is always fresh) and a successful response is
 * written to the cache fire-and-forget; when the network is unreachable the
 * last good copy is served from cache.
 */
async function fetchWithOfflineFallback(event) {
	const request = event.request;
	try {
		const networkResponse = await fetch(request);
		if (isCacheableRequest(request) && networkResponse?.ok) {
			event.waitUntil(cacheSuccessfulResponse(request.url, networkResponse.clone()));
		}
		return networkResponse;
	} catch {
		if (isCacheableRequest(request)) {
			// Runtime cache first (recently visited), then the bookmarks cache
			// (proactively saved posts) — the latter is what serves a bookmarked
			// post the reader never visited.
			const cached =
				(await self.caches.match(request, { cacheName: OFFLINE_CACHE_NAME })) ??
				(await self.caches.match(request, { cacheName: BOOKMARKS_CACHE_NAME }));
			if (cached) return cached;
		}
		// Nothing cached and offline: let the browser surface its usual error.
		throw new Error("Unreachable and not cached");
	}
}

// --- Bookmarked-post offline precache (PWA slice) ----------------------------

/**
 * Validate a path a message/asset hands us, resolving it to an absolute URL
 * when it is a safe, cacheable, same-origin URL. Returns null otherwise.
 * This is the single gate against accidentally caching admin/API/sensitive
 * pages — even though the client only sends reader post paths, we re-check
 * every candidate here (a compromised/misbehaving client cannot slip an
 * admin or /api URL past us).
 */
function toSafeCacheUrl(raw, baseUrl) {
	if (typeof raw !== "string" || raw === "") return null;
	if (raw.startsWith("data:") || raw.startsWith("//")) return null;
	let url;
	try {
		url = new URL(raw, baseUrl);
	} catch {
		return null;
	}
	if (url.origin !== self.location.origin) return null;
	if (!isCacheablePath(url.pathname)) return null;
	return url;
}

/** Store one response in the bounded bookmarks cache, evicting oldest past cap. */
async function cacheInBookmarks(url, response) {
	if (!response?.ok) return;
	const cache = await self.caches.open(BOOKMARKS_CACHE_NAME);
	await cache.put(url.href, response.clone());
	const keys = await cache.keys();
	if (keys.length > BOOKMARKS_CACHE_MAX) {
		await cache.delete(keys[0].url);
	}
}

/**
 * Fetch a bookmarked post document AND its render-critical assets (the /_nuxt
 * chunks, stylesheets and images its SSR HTML references) and store them in the
 * bookmarks cache. Fetching the sub-assets is what makes a bookmarked post that
 * was never visited fully renderable offline, not just a bare HTML shell.
 * Best-effort: any fetch failure (offline, 404) just skips that item.
 */
async function precacheBookmarkPost(path) {
	const url = toSafeCacheUrl(path, self.location.origin);
	if (!url) return;
	let resp;
	try {
		resp = await fetch(url.href, { credentials: "same-origin" });
	} catch {
		return; // offline right now — nothing to precache
	}
	if (!resp?.ok) return;

	// Store the document first so the post itself is available even if the
	// asset pass below is interrupted.
	await cacheInBookmarks(url, resp.clone());

	// Cache the assets the rendered document references. Read the body
	// separately so the response above is never consumed by the asset pass.
	let text = "";
	try {
		text = await resp.clone().text();
	} catch {
		return;
	}
	const seen = new Set();
	const assetCandidates = [];
	const attrRe = /(?:src|href)="([^"]+)"/g;
	let m = attrRe.exec(text);
	while (m !== null) {
		const assetUrl = toSafeCacheUrl(m[1], url.href);
		if (assetUrl && !seen.has(assetUrl.href)) {
			seen.add(assetUrl.href);
			assetCandidates.push(assetUrl);
		}
		m = attrRe.exec(text);
	}
	// Parallel, but each guarded independently so one failure can't drop the rest.
	await Promise.all(
		assetCandidates.map(async (assetUrl) => {
			try {
				const assetResp = await fetch(assetUrl.href, { credentials: "same-origin" });
				if (assetResp?.ok) await cacheInBookmarks(assetUrl, assetResp);
			} catch {
				/* skip un-fetchable asset */
			}
		}),
	);
}

/**
 * Precache every bookmarked post path. Iterates serially to avoid stampeding
 * the network when a reader has a large library; the cache write is what
 * matters, so walls of parallel fetches would only add churn.
 */
async function precacheBookmarks(paths) {
	if (!Array.isArray(paths)) return;
	for (const path of paths) {
		await precacheBookmarkPost(path);
	}
}

/** Remove the un-bookmarked post paths (and their cached assets) from the
 *  bookmarks cache so a saved set never lingers after a reader unsaves it. */
async function unbookmarkPosts(paths) {
	if (!Array.isArray(paths)) return;
	const cache = await self.caches.open(BOOKMARKS_CACHE_NAME);
	const keys = await cache.keys();
	// Build the set of absolute URLs we should drop.
	const drop = new Set();
	for (const path of paths) {
		const url = toSafeCacheUrl(path, self.location.origin);
		if (url) drop.add(url.href);
	}
	// A post's assets live under /_nuxt with content-hashed names — we can't
	// map them back to a post path. Rather than guess, drop only the post
	// documents here; shared /_nuxt chunks are harmless to keep (they're also
	// needed by other cached posts), and bounded by the cache cap.
	for (const key of keys) {
		if (drop.has(key.url)) await cache.delete(key.url);
	}
}

/**
 * Handle a page → SW message.
 *  - { type: "offline-precache",  posts: string[] } — cache each saved post.
 *  - { type: "offline-unbookmark", posts: string[] } — drop unsaved posts.
 */
function handleMessage(event) {
	const data = event?.data;
	if (!data || typeof data !== "object") return;
	if (data.type === "offline-precache") {
		event.waitUntil(precacheBookmarks(data.posts));
	} else if (data.type === "offline-unbookmark") {
		event.waitUntil(unbookmarkPosts(data.posts));
	}
}

if (typeof self !== "undefined") {
	self.addEventListener("install", () => {
		self.skipWaiting();
	});

	self.addEventListener("activate", (event) => {
		// Delete stale bookmarks caches from an older schema, if any (the
		// versioned name already prevents collisions; this is for a schema
		// bump, keeping the origin tidy).
		event.waitUntil(
			(async () => {
				const names = await self.caches?.keys?.();
				if (!names) return;
				await Promise.all(
					names
						.filter((n) => n.startsWith("xblog-bookmarks-") && n !== BOOKMARKS_CACHE_NAME)
						.map((n) => self.caches.delete(n)),
				);
			})(),
		);
		event.waitUntil(self.clients.claim());
	});

	self.addEventListener("message", handleMessage);

	self.addEventListener("push", (event) => {
		const data = parsePushPayload(event.data ? event.data.text() : null);
		const title = typeof data.title === "string" && data.title ? data.title : "X-Blog";
		const options = {
			body: typeof data.body === "string" ? data.body : "",
			icon: "/logo.png",
			badge: "/logo.png",
			data: { url: normalizeClickUrl(data) },
		};
		event.waitUntil(self.registration.showNotification(title, options));
	});

	self.addEventListener("notificationclick", (event) => {
		event.notification.close();
		const url = normalizeClickUrl(event.notification.data || {});
		event.waitUntil(
			self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
				for (const client of clientList) {
					if (new URL(client.url).pathname === url) return client.focus();
				}
				return self.clients.openWindow(url);
			}),
		);
	});

	// Offline reading (round 384): take over cacheable requests. Requests we
	// do not respondWith here (API/admin/feeds/external) flow to the browser
	// network untouched.
	self.addEventListener("fetch", (event) => {
		if (!isCacheableRequest(event.request)) return;
		event.respondWith(fetchWithOfflineFallback(event));
	});
}
