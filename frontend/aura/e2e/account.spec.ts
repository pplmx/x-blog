/**
 * Reader account settings journey (DEC-067, TASK-142).
 *
 * A signed-in reader edits their display name, rotates their password (the
 * fresh token supersedes the old one — the new password logs in, the old one
 * is rejected), and sees/revokes the browser push device bound to their
 * account. Verifies self-service works end-to-end without email recovery.
 */

import { expect, type Page, test } from "@playwright/test";

let emailCounter = 0;
function freshEmail(): string {
	emailCounter += 1;
	return `account-${Date.now()}-${emailCounter}@example.com`;
}
const PASSWORD = "e2epass123";

async function stubPushStack(page: Page) {
	await page.addInitScript(() => {
		const bytes = (n: number) => {
			const a = new Uint8Array(n);
			for (let i = 0; i < n; i++) a[i] = (i * 7 + 1) & 0xff;
			return a;
		};
		const state = {
			sub: null as { endpoint: string; getKey(k: string): ArrayBuffer } | null,
		};
		class FakePushManager {
			async getSubscription() {
				return state.sub;
			}
			async subscribe() {
				state.sub = state.sub ?? {
					endpoint: "https://127.0.0.1:9/wpush/v2/account-device",
					getKey: (k: string) => bytes(k === "auth" ? 16 : 65).buffer,
				};
				return state.sub;
			}
		}
		Object.defineProperty(window, "PushManager", { value: FakePushManager, configurable: true });
		const fakeReg = { pushManager: new FakePushManager(), showNotification: () => {} };
		Object.defineProperty(window.navigator, "serviceWorker", {
			value: {
				register: async () => fakeReg,
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

test.describe("Reader account settings", () => {
	test("edits profile, rotates password, manages push devices", async ({ page, request }) => {
		const email = freshEmail();
		const reg = await request.post("/api/reader/register", {
			data: { email, password: PASSWORD, display_name: "OldName" },
		});
		expect(reg.status()).toBe(201);

		await page.goto("/login");
		await page.locator('input[type="email"]').fill(email);
		await page.locator('input[type="password"]').fill(PASSWORD);
		await page.locator("form").press("Enter");
		await page.waitForURL("**/bookmarks");

		// Open account settings from the header nav (auth-only link).
		await page.goto("/account");
		await expect(page.locator("h1", { hasText: "账号设置" })).toBeVisible({ timeout: 10000 });

		// --- Profile: display name prefilled, editable, persists ---
		const nameInput = page.locator("input[type='text']");
		await expect(nameInput).toHaveValue("OldName");
		await nameInput.fill("Renamed");
		await page.getByRole("button", { name: "保存" }).click();
		await expect(page.locator("text=已保存")).toBeVisible({ timeout: 5000 });

		// --- Password: rotate; new logs in, old is rejected ---
		// The account page has TWO `autocomplete="current-password"` inputs (the
		// password-rotation form's current password and the delete-account
		// confirmation field). Disambiguate by the rotation label's accessible
		// name, otherwise Playwright strict mode rejects the bare attribute
		// selector (pre-existing e2e break against the shared dev stack, ISS-121).
		await page.getByRole("textbox", { name: "当前密码" }).fill(PASSWORD);
		await page.locator('input[autocomplete="new-password"]').first().fill("freshpass789");
		await page.locator('input[autocomplete="new-password"]').nth(1).fill("freshpass789");
		await page.getByRole("button", { name: "修改密码" }).click();
		await expect(page.locator("text=密码已修改")).toBeVisible({ timeout: 5000 });

		// Old password no longer authenticates; the new one does.
		const oldLogin = await request.post("/api/reader/login", {
			data: { email, password: PASSWORD },
		});
		expect(oldLogin.status()).toBe(401);
		const newLogin = await request.post("/api/reader/login", {
			data: { email, password: "freshpass789" },
		});
		expect(newLogin.status()).toBe(200);

		// --- Push device: subscribe while signed in → appears → revoke ---
		await stubPushStack(page);
		await page.goto("/");
		await page.locator('button[aria-label="订阅新文章通知"]').click();
		await expect(page.locator('button[aria-label="已订阅新文章通知"]')).toBeVisible({
			timeout: 10000,
		});

		await page.goto("/account");
		await expect(page.locator("text=推送设备")).toBeVisible({ timeout: 10000 });
		const endpointHost = page.locator("text=127.0.0.1:9…");
		await expect(endpointHost).toBeVisible({ timeout: 10000 });

		page.once("dialog", (d) => d.accept());
		await page.getByRole("button", { name: "移除" }).click();
		await expect(page.locator("text=还没有绑定任何推送设备")).toBeVisible({ timeout: 10000 });
	});
});
