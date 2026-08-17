/**
 * Web Push service worker (DEC-055, TASK-118).
 *
 * Registered at /sw.js by usePushSubscription (navigator.serviceWorker.register
 * with the default classic scope "/"). Two jobs:
 *
 *   - "push": the push service delivered a message the backend encrypted for
 *     this subscription; parse the JSON payload and show a notification.
 *   - "notificationclick": focus the already-open matching tab, else open it.
 *
 * Kept dependency-free and self-contained (classic service workers cannot use
 * ES module import/export). The pure helpers here are exercised in vitest via
 * `tests/sw.spec.ts`, which loads this file with a fake `self`.
 */

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
}
