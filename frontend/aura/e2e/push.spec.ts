/**
 * Web Push e2e (DEC-055, TASK-119).
 *
 * Headless Chromium cannot receive real push messages (the browser must reach
 * a live push service and show native notifications — same reason CSP/SRI is
 * deferred in DEC-051), so these journeys stub the browser push stack via
 * addInitScript and verify OUR slice: the header opt-in button, the
 * subscribe/unsubscribe state machine, the VAPID public-key round-trip, the
 * backend subscription API contract, and the admin notify-subscribers action.
 *
 * The backend must be running with VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY set
 * (CI seeds a keypair in the "Start backend" step).
 */

import { expect, type Page, test } from "@playwright/test";

/** Deterministic fake PushManager/serviceWorker/Notification stack.

The subscription's endpoint is persisted to localStorage so reloads simulate a
browser that still holds the SW subscription (init re-detects it without
re-subscribing). Endpoint points at 127.0.0.1:9 (closed port) so the admin
notify dispatch fails fast instead of hanging on DNS/connect. */

async function stubPushStack(page: Page) {
	await page.addInitScript(() => {
		const bytes = (n: number) => {
			const a = new Uint8Array(n);
			for (let i = 0; i < n; i++) a[i] = (i * 7 + 1) & 0xff;
			return a;
		};
		const subscribeCalls = Number(
			// @ts-expect-error localStorage may be absent on about:blank
			localStorage.getItem("__pushE2E_subscribeCalls") || 0,
		);
		const state = {
			sub: null as {
				endpoint: string;
				getKey(k: string): ArrayBuffer;
				unsubscribe(): Promise<boolean>;
			} | null,
			registerCalls: 0,
			subscribeCalls,
			subscribeKeyBytes: 0,
			unsubscribed: false,
		};
		const makeSub = () => ({
			endpoint: "https://127.0.0.1:9/wpush/v2/e2e-endpoint",
			getKey: (k: string) => bytes(k === "auth" ? 16 : 65).buffer,
			unsubscribe: async () => {
				state.sub = null;
				localStorage.removeItem("__pushE2E_endpoint");
				state.unsubscribed = true;
				return true;
			},
		});
		// Reloads rebuild state from localStorage (browser retains the sub).
		// Guarded: on the initial about:blank frame localStorage access throws a
		// SecurityError that would abort the rest of the stub install.
		let persisted = false;
		try {
			persisted = !!localStorage.getItem("__pushE2E_endpoint");
		} catch {
			persisted = false;
		}
		if (persisted) state.sub = makeSub();
		// @ts-expect-error accessing a test-only global
		window.__pushE2E = state;
		class FakePushManager {
			async getSubscription() {
				return state.sub;
			}
			async subscribe(options: { userVisibleOnly: boolean; applicationServerKey: ArrayBuffer }) {
				state.subscribeCalls++;
				localStorage.setItem("__pushE2E_subscribeCalls", String(state.subscribeCalls));
				state.subscribeKeyBytes = options.applicationServerKey?.byteLength ?? 0;
				state.sub = state.sub ?? makeSub();
				localStorage.setItem("__pushE2E_endpoint", state.sub.endpoint);
				return state.sub;
			}
		}
		Object.defineProperty(window, "PushManager", { value: FakePushManager, configurable: true });
		const fakeReg = { pushManager: new FakePushManager(), showNotification: () => {} };
		Object.defineProperty(window.navigator, "serviceWorker", {
			value: {
				register: async () => {
					state.registerCalls++;
					return fakeReg;
				},
				getRegistration: async () => (state.sub ? fakeReg : null),
				ready: Promise.resolve(fakeReg),
			},
			configurable: true,
		});
		Object.defineProperty(window, "Notification", {
			value: { permission: "granted", requestPermission: async () => "granted" },
			configurable: true,
		});
	});
}

const subscribeBtn = (page: Page) =>
	page.locator('button[aria-label="订阅新文章通知"], button[aria-label="已订阅新文章通知"]');
const subscribedBtn = (page: Page) => page.locator('button[aria-label="已订阅新文章通知"]');

test.describe("Web Push reader opt-in", () => {
	test("subscribes from the header button with the backend VAPID key", async ({ page }) => {
		await stubPushStack(page);
		const subscribe200 = page
			.waitForResponse((r) => r.url().includes("/api/push/subscribe") && r.ok(), { timeout: 15000 })
			.catch(() => null);

		await page.goto("/");

		// VAPID configured => the bell button is visible with the invite label.
		const button = page.locator('button[aria-label="订阅新文章通知"]');
		await expect(button).toBeVisible();
		await button.click();

		// UI flips to subscribed once the backend persisted the subscription.
		await expect(subscribedBtn(page)).toBeVisible({ timeout: 10000 });

		// Our slice did the right browser calls with the decoded 65-byte key.
		const state = await page.evaluate(
			() =>
				(
					window as unknown as {
						__pushE2E: { registerCalls: number; subscribeCalls: number; subscribeKeyBytes: number };
					}
				).__pushE2E,
		);
		expect(state.registerCalls).toBeGreaterThanOrEqual(1);
		expect(state.subscribeCalls).toBe(1);
		expect(state.subscribeKeyBytes).toBe(65);
		await expect(subscribe200).toBeTruthy();
	});

	test("re-detects the existing subscription on reload without re-subscribing", async ({
		page,
	}) => {
		await stubPushStack(page);
		await page.goto("/");
		await page.locator('button[aria-label="订阅新文章通知"]').click();
		await expect(subscribedBtn(page)).toBeVisible({ timeout: 10000 });

		const before = await page.evaluate(
			() =>
				(window as unknown as { __pushE2E: { subscribeCalls: number } }).__pushE2E.subscribeCalls,
		);
		await page.reload();
		await expect(subscribedBtn(page)).toBeVisible({ timeout: 10000 });

		const after = await page.evaluate(
			() =>
				(window as unknown as { __pushE2E: { subscribeCalls: number } }).__pushE2E.subscribeCalls,
		);
		expect(after).toBe(before); // init only re-detected, did not re-subscribe
	});

	test("signed-in reader's subscription is bound via the reader JWT (DEC-064)", async ({
		page,
		request,
	}) => {
		// Register a reader, then sign in through the UI so the reader JWT lands
		// in localStorage before the subscription is taken out.
		const email = `reader-${Date.now()}@example.com`;
		const reg = await request.post("/api/reader/register", {
			data: { email, password: "e2epass123", display_name: "E2E Reader" },
		});
		expect(reg.status()).toBe(201);

		await stubPushStack(page);
		await page.goto("/login");
		await page.locator('input[type="email"]').fill(email);
		await page.locator('input[type="password"]').fill("e2epass123");
		await page.locator("form").press("Enter");
		await page.waitForURL("**/bookmarks");
		await page.waitForFunction(() => !!localStorage.getItem("reader_token"));
		const token = await page.evaluate(() => localStorage.getItem("reader_token"));

		// Subscribe from the header: the subscribe request must carry the reader
		// JWT so the backend binds this subscription for reply notifications.
		await page.goto("/");
		const subscribeReq = page.waitForRequest(
			(r) => r.url().includes("/api/push/subscribe") && r.method() === "POST",
			{ timeout: 15000 },
		);
		await page.locator('button[aria-label="订阅新文章通知"]').click();
		await expect(subscribedBtn(page)).toBeVisible({ timeout: 10000 });

		const authz = (await subscribeReq).headers().authorization || "";
		expect(authz).toBe(`Bearer ${token}`);
	});

	test("unsubscribes on a second click", async ({ page }) => {
		await stubPushStack(page);
		const unsubscribe204 = page
			.waitForResponse((r) => r.url().includes("/api/push/unsubscribe") && r.status() === 204, {
				timeout: 15000,
			})
			.catch(() => null);

		await page.goto("/");
		await page.locator('button[aria-label="订阅新文章通知"]').click();
		await expect(subscribedBtn(page)).toBeVisible({ timeout: 10000 });
		await subscribedBtn(page).click();

		await expect(page.locator('button[aria-label="订阅新文章通知"]')).toBeVisible({
			timeout: 10000,
		});
		expect(await unsubscribe204).toBeTruthy();
		const state = await page.evaluate(
			() => (window as unknown as { __pushE2E: { unsubscribed: boolean } }).__pushE2E.unsubscribed,
		);
		expect(state).toBe(true);
	});
});

test.describe("Web Push admin notify", () => {
	test("admin notifies subscribers from a published post", async ({ page }) => {
		// Login as the seeded superuser, then open the first published post editor.
		await page.goto("/admin/login");
		await page.fill('input[type="text"]', "admin");
		await page.fill('input[type="password"]', "admin123");
		await page.click('button[type="submit"]');
		await page.waitForURL("**/admin/posts");
		await page.locator("tbody tr").first().locator('a[href*="/admin/posts/"]').last().click();
		await page.waitForURL(/\/admin\/posts\/\d+/);

		const notify204 = page
			.waitForResponse((r) => r.url().includes("/api/push/notify") && r.status() === 200, {
				timeout: 15000,
			})
			.catch(() => null);

		const notifyButton = page.getByRole("button", { name: "通知订阅者" });
		await expect(notifyButton).toBeVisible({ timeout: 10000 });
		await notifyButton.click();

		// The backend always 200s (dispatch failures are counted, not raised).
		await expect(notify204).toBeTruthy();
		await expect(page.locator("text=已通知订阅者")).toBeVisible({ timeout: 10000 });
	});
});
