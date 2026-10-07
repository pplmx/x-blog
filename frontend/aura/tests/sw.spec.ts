/**
 * Service worker behavior tests (DEC-055, TASK-118).
 *
 * Classic service workers cannot import/export, so this loads public/sw.js
 * in a fake `self` scope and drives its registered event handlers directly:
 * push (payload parsing -> showNotification, malformed payloads degrade) and
 * notificationclick (focus the matching tab, else open the URL). The handler
 * registration itself is also the syntax check for the SW file.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

type EventHandler = (event: unknown) => void;

function loadServiceWorker(overrides: Record<string, unknown> = {}) {
	// vitest transforms test files so import.meta.url is not a file:// URL;
	// resolve against the package root (vitest runs from frontend/aura).
	const source = readFileSync(resolve(process.cwd(), "public/sw.js"), "utf8");
	const handlers: Record<string, EventHandler> = {};
	const clients = {
		matchAll: vi.fn(),
		openWindow: vi.fn().mockResolvedValue(undefined),
		claim: vi.fn(),
	};
	const registration = { showNotification: vi.fn().mockResolvedValue(undefined) };
	const self = {
		addEventListener: (type: string, fn: EventHandler) => {
			handlers[type] = fn;
		},
		skipWaiting: vi.fn(),
		clients,
		registration,
		location: { origin: "https://blog.example.com" },
		...overrides,
	};
	// Evaluate the classic SW with `self` bound to the fake scope.
	new Function("self", source)(self);
	return { handlers, clients, registration };
}

// Capture the promise the handler hands to event.waitUntil so tests can await
// the async matchAll/… callback chain before asserting on it.
let lastWaitUntil: Promise<unknown> | undefined;
const waitUntil = (p: Promise<unknown> | undefined): Promise<unknown> | undefined => {
	lastWaitUntil = p;
	return p;
};
const flushWaitUntil = async () => {
	await lastWaitUntil;
	lastWaitUntil = undefined;
};

describe("service worker (public/sw.js)", () => {
	it("register() skips waiting and claims clients on activation", () => {
		const { handlers, clients } = loadServiceWorker();
		handlers.install?.({});
		handlers.activate?.({ waitUntil });
		expect(clients.claim).toHaveBeenCalled();
	});

	it("shows a notification from the push payload with a normalized click URL", () => {
		const { handlers, registration } = loadServiceWorker();
		const event = {
			data: {
				text: () => JSON.stringify({ title: "新文章", body: "快来看", url: "/posts/hello" }),
			},
			waitUntil,
		};
		handlers.push?.(event);
		expect(registration.showNotification).toHaveBeenCalledWith(
			"新文章",
			expect.objectContaining({
				body: "快来看",
				icon: "/logo.png",
				data: { url: "/posts/hello" },
			}),
		);
	});

	it("degrades an empty or malformed payload to a default notification", () => {
		const { handlers, registration } = loadServiceWorker();
		handlers.push?.({ data: { text: () => "not json" }, waitUntil });
		expect(registration.showNotification).toHaveBeenCalledWith(
			"X-Blog",
			expect.objectContaining({ body: "", data: { url: "/" } }),
		);
	});

	it("rejects a protocol-relative click target (falls back to /)", () => {
		const { handlers, registration } = loadServiceWorker();
		handlers.push?.({
			data: { text: () => JSON.stringify({ title: "x", url: "//evil.example.com" }) },
			waitUntil,
		});
		expect(registration.showNotification).toHaveBeenCalledWith(
			"x",
			expect.objectContaining({ data: { url: "/" } }),
		);
	});

	it("notificationclick focuses an already-open matching tab", async () => {
		const { handlers, clients } = loadServiceWorker();
		const focus = vi.fn().mockResolvedValue(undefined);
		clients.matchAll.mockResolvedValue([
			{ url: "https://blog.example.com/about" },
			{ url: "https://blog.example.com/posts/hello", focus },
		]);
		const event = {
			notification: { close: vi.fn(), data: { url: "/posts/hello" } },
			waitUntil,
		};
		handlers.notificationclick?.(event);
		await flushWaitUntil();
		expect(focus).toHaveBeenCalled();
		expect(clients.openWindow).not.toHaveBeenCalled();
	});

	it("notificationclick opens the URL when no tab matches", async () => {
		const { handlers, clients } = loadServiceWorker();
		clients.matchAll.mockResolvedValue([{ url: "https://blog.example.com/about" }]);
		const event = {
			notification: { close: vi.fn(), data: { url: "/posts/hello" } },
			waitUntil,
		};
		handlers.notificationclick?.(event);
		await flushWaitUntil();
		expect(clients.openWindow).toHaveBeenCalledWith("/posts/hello");
	});
});

describe("service worker offline cache (round 384)", () => {
	const origin = "https://blog.example.com";
	const location = { origin };
	// Shared fake CacheStorage: put/match/key-sets against a URL-keyed Map, so
	// the SW's open()/keys()/delete() bookkeeping is observable.
	const cacheStore = new Map<string, unknown>();
	const caches = {
		open: vi.fn(async () => ({
			put: vi.fn(async (url: string, resp: unknown) => cacheStore.set(url, resp)),
			keys: vi.fn(async () => Array.from(cacheStore.keys()).map((url) => ({ url }))),
			delete: vi.fn(async (url: string) => cacheStore.delete(url)),
		})),
		match: vi.fn(async (req: unknown) => {
			const url = typeof req === "string" ? req : (req as { url: string }).url;
			return cacheStore.get(url);
		}),
	};

	function okResponse() {
		return { ok: true, clone: () => okResponse() } as unknown as Response;
	}
	function request(url: string, method = "GET") {
		return { method, url, mode: "navigate" } as unknown as Request;
	}
	/** Drive the SW's fetch handler and return the respondWith/waitUntil refs. */
	function driveFetch(
		handlers: Record<string, EventHandler>,
		req: unknown,
		rw: (p: Promise<unknown>) => void,
		wu: EventHandler = vi.fn(),
	) {
		handlers.fetch?.({ request: req, respondWith: rw, waitUntil: wu });
	}

	beforeEach(() => cacheStore.clear());
	afterEach(() => vi.unstubAllGlobals());

	it("caches a successful same-origin GET and serves it when offline", async () => {
		const { handlers } = loadServiceWorker({ caches, location });
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okResponse()));
		const waits: Promise<unknown>[] = [];
		let served: Promise<unknown> | undefined;
		driveFetch(
			handlers,
			request(`${origin}/posts/hello`),
			(p) => (served = p),
			(p) => waits.push(p as Promise<unknown>),
		);
		expect(served).toBeDefined();
		// The cache write is fire-and-forget via event.waitUntil, so wait for it
		// to be scheduled before asserting the store.
		await vi.waitFor(() => expect(waits.length).toBeGreaterThan(0));
		await Promise.all([served, ...waits]);
		expect(cacheStore.has(`${origin}/posts/hello`)).toBe(true);

		// Network now unreachable: the cached copy is served.
		vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
		let servedOffline: Promise<unknown> | undefined;
		driveFetch(handlers, request(`${origin}/posts/hello`), (p) => (servedOffline = p));
		await expect(servedOffline).resolves.toBe(cacheStore.get(`${origin}/posts/hello`));
	});

	it("never takes over API/admin/feed/cross-origin/non-GET requests", () => {
		const { handlers } = loadServiceWorker({ caches, location });
		const respondWith = vi.fn();
		const targets = [
			`${origin}/api/posts`,
			`${origin}/admin/posts`,
			`${origin}/rss/feed.xml`,
			`${origin}/feed.xml`,
			`${origin}/sitemap.xml`,
			"https://other.example.com/posts/x",
		];
		for (const url of targets) {
			respondWith.mockClear();
			driveFetch(handlers, request(url), respondWith);
			expect(respondWith).not.toHaveBeenCalled();
		}
		respondWith.mockClear();
		handlers.fetch?.({
			request: request(`${origin}/posts/hello`, "POST"),
			respondWith,
			waitUntil: vi.fn(),
		});
		expect(respondWith).not.toHaveBeenCalled();
	});

	it("evicts the oldest entry once the cache cap is exceeded", async () => {
		const { handlers } = loadServiceWorker({ caches, location });
		// Pre-seed to the cap via the same CacheStorage the SW writes through.
		const cap = 60;
		for (let i = 0; i < cap; i++) {
			await (await caches.open()).put(`${origin}/seed-${i}`, okResponse());
		}
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okResponse()));
		const waits: Promise<unknown>[] = [];
		let served: Promise<unknown> | undefined;
		driveFetch(
			handlers,
			request(`${origin}/posts/new`),
			(p) => (served = p),
			(p) => waits.push(p as Promise<unknown>),
		);
		await vi.waitFor(() => expect(waits.length).toBeGreaterThan(0));
		await Promise.all([served, ...waits]);
		expect(cacheStore.size).toBe(cap); // 61st entry evicted the first
		expect(cacheStore.has(`${origin}/seed-0`)).toBe(false);
		expect(cacheStore.has(`${origin}/posts/new`)).toBe(true);
	});

	it("lets the network error surface when offline with nothing cached", async () => {
		const { handlers } = loadServiceWorker({ caches, location });
		vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
		let served: Promise<unknown> | undefined;
		driveFetch(handlers, request(`${origin}/posts/never-visited`), (p) => (served = p));
		await expect(served).rejects.toThrow("Unreachable and not cached");
	});
});

describe("service worker bookmarks offline cache (PWA slice)", () => {
	const origin = "https://blog.example.com";
	const location = { origin };
	// Same shared fake CacheStorage as the runtime-cache suite: URL-keyed Map.
	const cacheStore = new Map<string, unknown>();
	const caches = {
		open: vi.fn(async () => ({
			put: vi.fn(async (url: string, resp: unknown) => cacheStore.set(url, resp)),
			keys: vi.fn(async () => Array.from(cacheStore.keys()).map((url) => ({ url }))),
			delete: vi.fn(async (url: string) => cacheStore.delete(url)),
		})),
		match: vi.fn(async (req: unknown) => cacheStore.get((req as Request).url)),
	};

	function okResponse() {
		return { ok: true, clone: () => okResponse() } as unknown as Response;
	}
	function request(url: string, method = "GET") {
		return { method, url, mode: "navigate" } as unknown as Request;
	}
	/** A post HTML response whose body references a cacheable /_nuxt asset. */
	function postHtml(assetUrl: string) {
		const body = `<html><head><script src="${assetUrl}"></script></head><body>hi</body></html>`;
		return {
			ok: true,
			clone: () => postHtml(assetUrl),
			text: async () => body,
		} as unknown as Response;
	}

	/** Drive the registered message handler and await its waitUntil promise. */
	async function driveMessage(
		handlers: Record<string, EventHandler>,
		data: unknown,
	): Promise<void> {
		const waits: Promise<unknown>[] = [];
		handlers.message?.({ data, waitUntil: (p: Promise<unknown>) => waits.push(p) });
		await Promise.all(waits);
	}

	beforeEach(() => cacheStore.clear());
	afterEach(() => vi.unstubAllGlobals());

	it("precaches a bookmarked post's document AND its referenced asset on message", async () => {
		const { handlers } = loadServiceWorker({ caches, location });
		const postUrl = `${origin}/posts/hello`;
		const assetUrl = `${origin}/_nuxt/chunk.js`;
		vi.stubGlobal(
			"fetch",
			vi.fn((url: string) =>
				url === postUrl ? Promise.resolve(postHtml(assetUrl)) : Promise.resolve(okResponse()),
			),
		);
		await driveMessage(handlers, { type: "offline-precache", posts: ["/posts/hello"] });
		expect(cacheStore.has(postUrl)).toBe(true);
		// The /_nuxt asset the post's SSR HTML references is also cached, so the
		// post fully renders offline even though it was never visited.
		expect(cacheStore.has(assetUrl)).toBe(true);
	});

	it("never precaches admin/API/feed/cross-origin/data: paths via message", async () => {
		const { handlers } = loadServiceWorker({ caches, location });
		const fetchMock = vi.fn().mockResolvedValue(okResponse());
		vi.stubGlobal("fetch", fetchMock);
		await driveMessage(handlers, {
			type: "offline-precache",
			posts: [
				"/admin/posts",
				"/api/reader/me",
				"/rss/feed.xml",
				`${origin}/sitemap.xml`,
				"https://evil.example.com/posts/x",
				"data:text/html,hi",
				"//protocol-relative.example.com/a",
			],
		});
		expect(fetchMock).not.toHaveBeenCalled();
		expect(cacheStore.size).toBe(0);
	});

	it("skips admin/API assets referenced inside a precached post (defense in depth)", async () => {
		const { handlers } = loadServiceWorker({ caches, location });
		const postUrl = `${origin}/posts/hello`;
		const body =
			`<script src="${origin}/_nuxt/ok.js"></script>` +
			`<script src="${origin}/admin/console.js"></script>` +
			`<script src="${origin}/api/posts"></script>`;
		vi.stubGlobal(
			"fetch",
			vi.fn((url: string) => {
				if (url === postUrl)
					return Promise.resolve({
						ok: true,
						clone: function clone() {
							return this;
						},
						text: async () => body,
					} as unknown as Response);
				return Promise.resolve(okResponse());
			}),
		);
		await driveMessage(handlers, { type: "offline-precache", posts: ["/posts/hello"] });
		expect(cacheStore.has(`${origin}/_nuxt/ok.js`)).toBe(true);
		expect(cacheStore.has(`${origin}/admin/console.js`)).toBe(false);
		expect(cacheStore.has(`${origin}/api/posts`)).toBe(false);
		// fetch was called for the post + the allowed asset only.
		expect(cacheStore.size).toBe(2);
	});

	it("prunes an un-bookmarked post from the bookmarks cache on message", async () => {
		const { handlers } = loadServiceWorker({ caches, location });
		const postUrl = `${origin}/posts/hello`;
		await (await caches.open()).put(postUrl, okResponse());
		await driveMessage(handlers, { type: "offline-unbookmark", posts: ["/posts/hello"] });
		expect(cacheStore.has(postUrl)).toBe(false);
	});

	it("serves a bookmarked post from cache offline even when it was never visited", async () => {
		const { handlers } = loadServiceWorker({ caches, location });
		const postUrl = `${origin}/posts/hello`;
		await (await caches.open()).put(postUrl, okResponse());
		vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
		let served: Promise<unknown> | undefined;
		handlers.fetch?.({
			request: request(postUrl),
			respondWith: (p: Promise<unknown>) => (served = p),
		});
		await expect(served).resolves.toBe(cacheStore.get(postUrl));
	});
});
