/**
 * usePushSubscription composable tests (DEC-055, TASK-118).
 *
 * Drives the opt-in state machine with a fake browser push stack
 * (navigator.serviceWorker / pushManager, Notification, fetch): SSR-safe
 * unsupported default, unconfigured backend, permission denied, subscribe
 * happy path (registers the SW and persists to the backend), and unsubscribe.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A structurally valid base64url VAPID public key: 87 chars (65-byte
// uncompressed EC point, first byte 0x04) decode cleanly with one "=" pad.
const PUBLIC_KEY = `B${"A".repeat(86)}`;
const ENDPOINT = "https://push.example.com/wpush/v2/abc";

function fakePushSubscription(endpoint: string = ENDPOINT) {
	return {
		endpoint,
		getKey: vi.fn((k: string) => {
			// 32 arbitrary bytes are enough — the wire encoding is what we assert.
			const bytes = new Uint8Array(k === "auth" ? 16 : 65).map((_, i) => i + 1);
			return bytes.buffer;
		}),
		unsubscribe: vi.fn().mockResolvedValue(true),
	};
}

function setupBrowser(
	opts: {
		permission?: string;
		existingSubscription?: ReturnType<typeof fakePushSubscription> | null;
		register?: boolean;
	} = {},
) {
	const sub = opts.existingSubscription ?? null;
	const reg = {
		pushManager: {
			getSubscription: vi.fn().mockResolvedValue(sub),
			subscribe: vi.fn().mockResolvedValue(sub ?? fakePushSubscription()),
		},
	};
	const registration = opts.register === false ? null : reg;
	const svc = {
		register: vi.fn().mockResolvedValue(reg),
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		getRegistration: vi.fn().mockResolvedValue(registration as any),
		ready: Promise.resolve(reg),
	};
	// happy-dom's navigator lacks serviceWorker — define it.
	Object.defineProperty(window.navigator, "serviceWorker", {
		value: svc,
		configurable: true,
	});
	Object.defineProperty(window, "PushManager", {
		value: class {},
		configurable: true,
	});
	Object.defineProperty(window, "Notification", {
		value: {
			permission: opts.permission ?? "default",
			requestPermission: vi.fn().mockResolvedValue(opts.permission ?? "granted"),
		},
		configurable: true,
	});
	return { svc, reg };
}

beforeEach(() => {
	vi.restoreAllMocks();
	// Re-stub here (not module scoped) so afterEach's unstubAllGlobals does not
	// remove it mid-run — later tests would throw on useRuntimeConfig().
	vi.stubGlobal("useRuntimeConfig", () => ({
		public: { apiUrl: "http://localhost:18888" },
	}));
	// Fresh module so the module-scoped `status` singleton resets per test.
	vi.resetModules();
	globalThis.fetch = vi.fn().mockResolvedValue({
		ok: true,
		json: () => Promise.resolve({ public_key: PUBLIC_KEY }),
	});
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("usePushSubscription", () => {
	it("starts unsupported when the browser has no push stack (SSR safe)", async () => {
		const { usePushSubscription } = await import("~/composables/usePushSubscription");
		const { status, init } = usePushSubscription();
		// No navigator.serviceWorker, no PushManager -> unsupported.
		await init();
		expect(status.value).toBe("unsupported");
	});

	it("reports unconfigured when the backend exposes no VAPID key", async () => {
		setupBrowser();
		globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 503 });
		const { usePushSubscription } = await import("~/composables/usePushSubscription");
		const { status, init } = usePushSubscription();
		await init();
		expect(status.value).toBe("unconfigured");
	});

	it("settles on idle when supported + configured + no existing subscription", async () => {
		setupBrowser();
		const { usePushSubscription } = await import("~/composables/usePushSubscription");
		const { status, init } = usePushSubscription();
		await init();
		expect(status.value).toBe("idle");
	});

	it("re-detects an existing subscription as subscribed on init", async () => {
		setupBrowser({ permission: "granted", existingSubscription: fakePushSubscription() });
		const { usePushSubscription } = await import("~/composables/usePushSubscription");
		const { status, init } = usePushSubscription();
		await init();
		expect(status.value).toBe("subscribed");
	});

	it("shows denied when the browser has blocked notifications", async () => {
		setupBrowser({ permission: "denied" });
		const { usePushSubscription } = await import("~/composables/usePushSubscription");
		const { status, init } = usePushSubscription();
		await init();
		expect(status.value).toBe("denied");
	});

	it("subscribe registers the SW, requests permission, persists to the backend", async () => {
		const { svc, reg } = setupBrowser({ permission: "granted" });
		reg.pushManager.subscribe.mockResolvedValue(fakePushSubscription(ENDPOINT));
		const { usePushSubscription } = await import("~/composables/usePushSubscription");
		const { status, subscribe } = usePushSubscription();

		await subscribe();

		expect(svc.register).toHaveBeenCalledWith("/sw.js");
		expect(reg.pushManager.subscribe).toHaveBeenCalledWith(
			expect.objectContaining({ userVisibleOnly: true }),
		);
		expect(status.value).toBe("subscribed");
		expect(globalThis.fetch).toHaveBeenCalledWith(
			"http://localhost:18888/api/push/subscribe",
			expect.objectContaining({
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: expect.stringContaining(ENDPOINT),
			}),
		);
	});

	it("subscribe carries new-post prefs on the request body (DEC-076/TASK-147)", async () => {
		const { reg } = setupBrowser({ permission: "granted" });
		reg.pushManager.subscribe.mockResolvedValue(fakePushSubscription(ENDPOINT));
		const { usePushSubscription } = await import("~/composables/usePushSubscription");
		const { status, subscribe } = usePushSubscription();

		await subscribe({ want: true, categoryId: 7 });

		expect(status.value).toBe("subscribed");
		expect(globalThis.fetch).toHaveBeenCalledWith(
			"http://localhost:18888/api/push/subscribe",
			expect.objectContaining({
				method: "POST",
				body: expect.stringContaining('"want_new_posts":true'),
			}),
		);
	});

	it("setNewPostPrefs upserts prefs on an existing subscription (DEC-076/TASK-147)", async () => {
		setupBrowser({ permission: "granted", existingSubscription: fakePushSubscription(ENDPOINT) });
		const { usePushSubscription } = await import("~/composables/usePushSubscription");
		const { status, init, setNewPostPrefs } = usePushSubscription();

		await init();
		expect(status.value).toBe("subscribed");

		await setNewPostPrefs({ want: true, categoryId: null });

		expect(globalThis.fetch).toHaveBeenCalledWith(
			expect.stringContaining("/api/push/subscribe"),
			expect.objectContaining({
				method: "POST",
				body: expect.stringContaining('"want_new_posts":true'),
			}),
		);
	});

	it("subscribe sends the reader JWT so the backend binds the reader (DEC-064)", async () => {
		localStorage.setItem("reader_token", "reader.jwt.token");
		const { svc, reg } = setupBrowser({ permission: "granted" });
		reg.pushManager.subscribe.mockResolvedValue(fakePushSubscription(ENDPOINT));
		const { usePushSubscription } = await import("~/composables/usePushSubscription");
		const { status, subscribe } = usePushSubscription();

		await subscribe();

		expect(svc.register).toHaveBeenCalledWith("/sw.js");
		expect(status.value).toBe("subscribed");
		expect(globalThis.fetch).toHaveBeenCalledWith(
			"http://localhost:18888/api/push/subscribe",
			expect.objectContaining({
				method: "POST",
				headers: expect.objectContaining({
					Authorization: "Bearer reader.jwt.token",
				}),
				body: expect.any(String),
			}),
		);
		localStorage.removeItem("reader_token");
	});

	it("subscribe rejects and reverts to idle when persisting to the backend fails (rethrow contract)", async () => {
		const { reg } = setupBrowser({ permission: "granted" });
		reg.pushManager.subscribe.mockResolvedValue(fakePushSubscription(ENDPOINT));
		// VAPID key fetch succeeds, but the subscribe POST returns 500 — a
		// transient failure the CALLER must be able to observe (per-call-site
		// surfacing; the initiating button decides the feedback, ISS-215).
		globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
			if (String(url).includes("/api/push/vapid-public-key")) {
				return { ok: true, json: () => Promise.resolve({ public_key: PUBLIC_KEY }) };
			}
			return { ok: false, status: 500 };
		});
		const { usePushSubscription } = await import("~/composables/usePushSubscription");
		const { status, subscribe } = usePushSubscription();

		await expect(subscribe()).rejects.toThrow();
		expect(status.value).toBe("idle");
	});

	it("subscribe stays idle when permission is refused", async () => {
		setupBrowser({ permission: "default" });
		const { usePushSubscription } = await import("~/composables/usePushSubscription");
		const { status, subscribe } = usePushSubscription();
		// requestPermission resolves 'denied'
		Object.defineProperty(window, "Notification", {
			value: {
				permission: "default",
				requestPermission: vi.fn().mockResolvedValue("denied"),
			},
			configurable: true,
		});
		await subscribe();
		expect(status.value).toBe("denied");
	});

	it("coalesces a second subscribe() fired while the first is in flight (single-flight, ISS-423)", async () => {
		// A double-click, or the header bell + a thread/category follow in the
		// same tick, calls subscribe() twice before status flips to
		// "subscribing" (that only happens after the backend key round-trip).
		// The second flow used to run its own Notification.requestPermission()
		// and its loser catch painted the shared module status a false "denied".
		const { svc, reg } = setupBrowser({ permission: "granted" });
		reg.pushManager.subscribe.mockResolvedValue(fakePushSubscription(ENDPOINT));
		const { usePushSubscription } = await import("~/composables/usePushSubscription");
		const { status, subscribe } = usePushSubscription();

		// Hold the VAPID key fetch open so both calls land inside the window
		// where status is still "(not yet) subscribing".
		let releaseKey: (() => void) | undefined;
		const keyHeld = new Promise<void>((r) => {
			releaseKey = r;
		});
		globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
			if (String(url).includes("/api/push/vapid-public-key")) {
				await keyHeld;
				return { ok: true, json: () => Promise.resolve({ public_key: PUBLIC_KEY }) };
			}
			return { ok: true, status: 200, json: () => Promise.resolve({}) };
		});

		const first = subscribe();
		const second = subscribe();
		releaseKey?.();
		await Promise.all([first, second]);

		// One permission flow, one backend persist — no duplicate subscribe.
		expect(svc.register).toHaveBeenCalledTimes(1);
		expect(globalThis.fetch).toHaveBeenCalledTimes(2); // key + single persist
		expect(status.value).toBe("subscribed");
	});

	it("subscribe falls back to unconfigured when the backend key is missing", async () => {
		setupBrowser();
		globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 503 });
		const { usePushSubscription } = await import("~/composables/usePushSubscription");
		const { status, subscribe } = usePushSubscription();
		await subscribe();
		expect(status.value).toBe("unconfigured");
	});

	it("unsubscribe removes the endpoint from the backend and unsubscribes locally", async () => {
		setupBrowser({ permission: "granted", existingSubscription: fakePushSubscription(ENDPOINT) });
		const { usePushSubscription } = await import("~/composables/usePushSubscription");
		const { status, init, unsubscribe } = usePushSubscription();
		await init();
		expect(status.value).toBe("subscribed");

		await unsubscribe();

		expect(status.value).toBe("idle");
		expect(globalThis.fetch).toHaveBeenCalledWith(
			"http://localhost:18888/api/push/unsubscribe",
			expect.objectContaining({ method: "POST" }),
		);
	});

	it("syncReaderBinding re-stamps an existing subscription with the reader JWT (DEC-064)", async () => {
		setupBrowser({ permission: "granted", existingSubscription: fakePushSubscription(ENDPOINT) });
		localStorage.setItem("reader_token", "reader.jwt.token");
		const { usePushSubscription } = await import("~/composables/usePushSubscription");
		const { status, init, syncReaderBinding } = usePushSubscription();
		await init();
		expect(status.value).toBe("subscribed");

		await syncReaderBinding();

		expect(globalThis.fetch).toHaveBeenCalledWith(
			"http://localhost:18888/api/push/subscribe",
			expect.objectContaining({
				method: "POST",
				headers: expect.objectContaining({ Authorization: "Bearer reader.jwt.token" }),
			}),
		);
		localStorage.removeItem("reader_token");
	});

	it("syncReaderBinding is a no-op when there is no subscription", async () => {
		setupBrowser();
		const { usePushSubscription } = await import("~/composables/usePushSubscription");
		const { status, init, syncReaderBinding } = usePushSubscription();
		await init();
		expect(status.value).toBe("idle");

		await syncReaderBinding();

		const calls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.filter(([url]) =>
			String(url).includes("/api/push/subscribe"),
		);
		expect(calls).toHaveLength(0);
	});

	it("urlBase64ToUint8Array decodes a base64url string to the right bytes", async () => {
		const { urlBase64ToUint8Array } = await import("~/composables/usePushSubscription");
		// "ARs..." decodes to 0x01, bytes 0x1B, 0xAD
		const bytes = urlBase64ToUint8Array("ARut");
		expect([...bytes]).toEqual([0x01, 0x1b, 0xad]);
	});

	it("apiBase falls back to an empty string when apiUrl is not configured", async () => {
		vi.stubGlobal("useRuntimeConfig", () => ({ public: { apiUrl: undefined } }));
		const { apiBase } = await import("~/composables/usePushSubscription");
		expect(apiBase()).toBe("");
	});

	it("fetchBackendPublicKey returns null when the public_key is not a string", async () => {
		globalThis.fetch = vi
			.fn()
			.mockResolvedValue({ ok: true, json: () => Promise.resolve({ public_key: 42 }) });
		const { fetchBackendPublicKey } = await import("~/composables/usePushSubscription");
		expect(await fetchBackendPublicKey()).toBeNull();
	});

	it("subscribe serializes null key buffers as empty base64url on the wire", async () => {
		const noKeys = (endpoint: string = ENDPOINT) => ({
			endpoint,
			getKey: () => null, // key material unavailable (e.g. cross-origin SW)
			unsubscribe: vi.fn().mockResolvedValue(true),
		});
		const { reg } = setupBrowser({ permission: "granted" });
		reg.pushManager.subscribe.mockResolvedValue(noKeys());
		const { usePushSubscription } = await import("~/composables/usePushSubscription");
		const { status, subscribe } = usePushSubscription();

		await subscribe();

		expect(status.value).toBe("subscribed");
		expect(globalThis.fetch).toHaveBeenCalledWith(
			expect.stringContaining("/api/push/subscribe"),
			expect.objectContaining({
				body: expect.stringContaining('"p256dh":""'),
			}),
		);
	});

	it("init reports idle when no service worker registration exists", async () => {
		setupBrowser({ register: false }); // getRegistration → null
		const { usePushSubscription } = await import("~/composables/usePushSubscription");
		const { status, init } = usePushSubscription();
		await init();
		expect(status.value).toBe("idle");
	});

	it("subscribe early-returns when notifications are already denied", async () => {
		const { svc } = setupBrowser({ permission: "denied" });
		const { usePushSubscription } = await import("~/composables/usePushSubscription");
		const { status, init, subscribe } = usePushSubscription();
		await init();
		expect(status.value).toBe("denied");

		const callsBefore = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length;
		await subscribe();

		expect(svc.register).not.toHaveBeenCalled();
		expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsBefore);
		expect(status.value).toBe("denied");
	});

	it("subscribe early-returns when the browser has no push stack", async () => {
		// Earlier tests' setupBrowser stubs leak onto window (defineProperty, not
		// stubGlobal) — delete the props entirely so the `in` checks are false and
		// isSupported() is genuinely false (isSupported only guards on existence).
		// @ts-expect-error deleting a stubbed global
		delete window.PushManager;
		// @ts-expect-error deleting a stubbed global
		delete window.Notification;
		// @ts-expect-error deleting a stubbed global
		delete window.navigator.serviceWorker;
		const { usePushSubscription } = await import("~/composables/usePushSubscription");
		const { status, subscribe } = usePushSubscription();
		await subscribe();
		expect(status.value).toBe("unsupported");
		expect(globalThis.fetch).not.toHaveBeenCalled();
	});

	it("subscribe proceeds once permission is granted at the prompt", async () => {
		const { reg } = setupBrowser({ permission: "default" });
		reg.pushManager.subscribe.mockResolvedValue(fakePushSubscription(ENDPOINT));
		// First visit: permission is "default", so subscribe must ask — and once
		// granted, must continue the flow rather than bail to "denied".
		Object.defineProperty(window, "Notification", {
			value: {
				permission: "default",
				requestPermission: vi.fn().mockResolvedValue("granted"),
			},
			configurable: true,
		});
		const { usePushSubscription } = await import("~/composables/usePushSubscription");
		const { status, subscribe } = usePushSubscription();

		await subscribe();

		expect(status.value).toBe("subscribed");
		expect(reg.pushManager.subscribe).toHaveBeenCalled();
	});

	it("subscribe reuses an existing browser subscription instead of creating a new one", async () => {
		const existing = fakePushSubscription(ENDPOINT);
		const { svc, reg } = setupBrowser({ permission: "granted", existingSubscription: existing });
		const { usePushSubscription } = await import("~/composables/usePushSubscription");
		const { status, subscribe } = usePushSubscription();

		await subscribe();

		expect(reg.pushManager.subscribe).not.toHaveBeenCalled();
		expect(svc.register).toHaveBeenCalledWith("/sw.js");
		expect(status.value).toBe("subscribed");
		expect(globalThis.fetch).toHaveBeenCalledWith(
			expect.stringContaining("/api/push/subscribe"),
			expect.objectContaining({ body: expect.stringContaining(ENDPOINT) }),
		);
	});

	it("unsubscribe is a no-op when the browser has no push stack", async () => {
		// Force an absent push stack (earlier setupBrowser stubs leak on window).
		// @ts-expect-error deleting a stubbed global
		delete window.PushManager;
		// @ts-expect-error deleting a stubbed global
		delete window.Notification;
		// @ts-expect-error deleting a stubbed global
		delete window.navigator.serviceWorker;
		const { usePushSubscription } = await import("~/composables/usePushSubscription");
		const { status, unsubscribe } = usePushSubscription();
		await unsubscribe();
		expect(status.value).toBe("unsupported");
		expect(globalThis.fetch).not.toHaveBeenCalled();
	});

	it("unsubscribe with no active subscription just returns to idle", async () => {
		setupBrowser(); // registration present, but no subscription yet
		const { usePushSubscription } = await import("~/composables/usePushSubscription");
		const { status, init, unsubscribe } = usePushSubscription();
		await init();
		expect(status.value).toBe("idle");

		await unsubscribe();

		expect(status.value).toBe("idle");
		const unsubCalls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.filter(([u]) =>
			String(u).includes("/api/push/unsubscribe"),
		);
		expect(unsubCalls).toHaveLength(0);
	});

	it("setNewPostPrefs remembers prefs without a backend call when not subscribed", async () => {
		setupBrowser();
		const { usePushSubscription } = await import("~/composables/usePushSubscription");
		const { status, init, setNewPostPrefs, newPostPrefs } = usePushSubscription();
		await init();
		expect(status.value).toBe("idle");

		await setNewPostPrefs({ want: true, categoryId: 3 });

		expect(newPostPrefs.value).toEqual({ want: true, categoryId: 3 });
		const subCalls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.filter(([u]) =>
			String(u).includes("/api/push/subscribe"),
		);
		expect(subCalls).toHaveLength(0);
	});

	it("subscribe sends no Authorization header when localStorage is unavailable", async () => {
		// localStorage can be inaccessible (denied storage); syncBackend must
		// skip the reader JWT instead of throwing on the read.
		const originalLS = window.localStorage;
		Object.defineProperty(window, "localStorage", { value: undefined, configurable: true });
		try {
			const { reg } = setupBrowser({ permission: "granted" });
			reg.pushManager.subscribe.mockResolvedValue(fakePushSubscription(ENDPOINT));
			const { usePushSubscription } = await import("~/composables/usePushSubscription");
			const { status, subscribe } = usePushSubscription();
			await subscribe();
			expect(status.value).toBe("subscribed");
			expect(globalThis.fetch).toHaveBeenCalledWith(
				expect.stringContaining("/api/push/subscribe"),
				expect.objectContaining({
					headers: { "Content-Type": "application/json" } as Record<string, string>,
				}),
			);
		} finally {
			Object.defineProperty(window, "localStorage", { value: originalLS, configurable: true });
		}
	});

	it("setNewPostPrefs skips the backend when the browser subscription disappeared", async () => {
		// Status can be "subscribed" while the browser-side subscription is
		// already gone (service worker reclaimed). The upsert must no-op, not 500.
		const { svc } = setupBrowser({
			permission: "granted",
			existingSubscription: fakePushSubscription(ENDPOINT),
		});
		const { usePushSubscription } = await import("~/composables/usePushSubscription");
		const { status, init, setNewPostPrefs } = usePushSubscription();
		await init();
		expect(status.value).toBe("subscribed");

		svc.getRegistration.mockResolvedValue(null);
		await setNewPostPrefs({ want: false, categoryId: null });

		const subCalls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.filter(([u]) =>
			String(u).includes("/api/push/subscribe"),
		);
		expect(subCalls).toHaveLength(0);
	});
});
