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
 *
 * Kept dependency-free and self-contained (classic service workers cannot use
 * ES module import/export). The pure helpers here are exercised in vitest via
 * `tests/sw.spec.ts`, which loads this file with a fake `self`.
 */

/** Runtime offline cache: name + bounded entry count (LRU-ish via key order). */
const OFFLINE_CACHE_NAME = "xblog-offline-v1";
const OFFLINE_CACHE_MAX = 60;

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
 * Whether a request belongs in the offline runtime cache: a successful-able
 * same-origin GET outside the API/admin/feed surface. Everything else (POSTs,
 * cross-origin, API JSON, admin console, RSS/sitemap) passes straight through
 * untouched.
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
	const { pathname } = url;
	if (pathname.startsWith("/api/") || pathname.startsWith("/admin")) return false;
	if (pathname.startsWith("/rss/") || pathname === "/feed.xml" || pathname === "/sitemap.xml") {
		return false;
	}
	return true;
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
			const cached = await self.caches.match(request, { cacheName: OFFLINE_CACHE_NAME });
			if (cached) return cached;
		}
		// Nothing cached and offline: let the browser surface its usual error.
		throw new Error("Unreachable and not cached");
	}
}

if (typeof self !== "undefined") {
	self.addEventListener("install", () => {
		self.skipWaiting();
	});

	self.addEventListener("activate", (event) => {
		event.waitUntil(self.clients.claim());
	});

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
