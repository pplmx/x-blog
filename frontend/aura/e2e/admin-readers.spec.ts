/**
 * Admin reader moderation journey (DEC-194, TASK-214, ISS-116).
 *
 * A reader registers through the public API; the admin sees them on the
 * /admin/readers table, deactivates the account from the UI (confirm dialog),
 * and the reader's live JWT dies plus their login is rejected. Reactivating
 * from the same row lets the reader sign in again (old tokens stay revoked).
 */

import { expect, test } from "@playwright/test";

let emailCounter = 0;
function freshEmail(): string {
	emailCounter += 1;
	return `areader-e2e-${Date.now()}-${emailCounter}@example.com`;
}
const PASSWORD = "e2epass123";

async function loginAdmin(page: import("@playwright/test").Page) {
	await page.goto("/admin/login");
	await page.fill('input[type="text"]', "admin");
	await page.fill('input[type="password"]', "admin123");
	await page.click('button[type="submit"]');
	await page.waitForURL("**/admin/posts");
}

test.describe("Admin reader moderation (DEC-194)", () => {
	test("register → listed → UI deactivate locks the reader out → UI reactivate restores login", async ({
		page,
		request,
	}) => {
		const email = freshEmail();

		// 1. A reader registers through the public API (auto-login token).
		const reg = await request.post("/api/reader/register", {
			data: { email, password: PASSWORD, display_name: "E2E Spam Reader" },
		});
		expect(reg.status()).toBe(201);
		const { access_token } = (await reg.json()) as { access_token: string };
		const me = await request.get("/api/reader/me", {
			headers: { Authorization: `Bearer ${access_token}` },
		});
		expect(me.status()).toBe(200);

		// 2. The admin sees the reader on the readers page.
		await loginAdmin(page);
		await page.goto("/admin/readers");
		const row = page.locator("tbody tr", { hasText: email });
		await expect(row).toBeVisible({ timeout: 10000 });
		await expect(row).toContainText("E2E Spam Reader");

		// 3. Deactivate from the UI (confirm the dialog).
		page.once("dialog", (dialog) => dialog.accept());
		await row.locator("button").click();
		await expect(row).toContainText("已停用", { timeout: 5000 });
		// The row's action is now "Activate" (patch applied in place).
		await expect(row.getByRole("button")).toContainText("启用");

		// 4. The deactivated reader is locked out: old JWT revoked, login 403.
		const deadMe = await request.get("/api/reader/me", {
			headers: { Authorization: `Bearer ${access_token}` },
		});
		expect([401, 403]).toContain(deadMe.status());
		const login = await request.post("/api/reader/login", {
			data: { email, password: PASSWORD },
		});
		expect(login.status()).toBe(403);

		// 5. Reactivate from the same row; the reader can sign in again
		//    (old tokens stay dead, but a fresh login succeeds).
		page.once("dialog", (dialog) => dialog.accept());
		await row.locator("button").click();
		await expect(row).toContainText("正常", { timeout: 5000 });

		const loginAgain = await request.post("/api/reader/login", {
			data: { email, password: PASSWORD },
		});
		expect(loginAgain.status()).toBe(200);
	});
});
