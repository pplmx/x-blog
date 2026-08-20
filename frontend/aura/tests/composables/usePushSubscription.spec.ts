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
const PUBLIC_KEY = "B" + "A".repeat(86);
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

	it("urlBase64ToUint8Array decodes a base64url string to the right bytes", async () => {
		const { urlBase64ToUint8Array } = await import("~/composables/usePushSubscription");
		// "ARs..." decodes to 0x01, bytes 0x1B, 0xAD
		const bytes = urlBase64ToUint8Array("ARut");
		expect([...bytes]).toEqual([0x01, 0x1b, 0xad]);
	});
});
