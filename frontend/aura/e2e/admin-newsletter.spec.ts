/**
 * Admin newsletter subscriber management journey (DEC-354, TASK-402).
 *
 * The guest newsletter (DEC-351) has no operator surface without this page:
 * an admin can't see who is on the list, how many are confirmed vs pending,
 * or remove an address. An address subscribes through the public API, the
 * admin sees it on the /admin/newsletter table (pending chip, since the
 * double opt-in link was never clicked), the email search narrows the list to
 * it, and the confirm delete removes the row — the backend then reports the
 * address gone while a decoy subscriber stays (only the intended row went).
 */

import { expect, test } from "@playwright/test";

let counter = 0;
function freshEmail(): string {
	counter += 1;
	return `admin-newsletter-${Date.now()}-${counter}@example.com`;
}

async function loginAdmin(page: import("@playwright/test").Page) {
	await page.goto("/admin/login");
	await page.fill('input[type="text"]', "admin");
	await page.fill('input[type="password"]', "admin123");
	await page.click('button[type="submit"]');
	await page.waitForURL("**/admin/posts");
}

test.describe("Admin newsletter management (DEC-354)", () => {
	test("subscribe → listed with pending chip → search narrows → confirm delete removes only that row", async ({
		page,
		request,
	}) => {
		const target = freshEmail();
		const decoy = freshEmail();

		// Public subscribe (double opt-in; the confirmation link is not
		// clicked, so both addresses stay pending).
		for (const email of [decoy, target]) {
			const sub = await request.post("/api/newsletter/subscribe", {
				data: { email },
			});
			expect(sub.status()).toBe(202);
		}

		await loginAdmin(page);
		await page.goto("/admin/newsletter");

		// Both subscribers render, the target as a pending (待确认) chip —
		// page default language is zh, same as the readers/other admin trips.
		const row = page.locator("tbody tr", { hasText: target });
		await expect(row).toBeVisible({ timeout: 10000 });
		await expect(row).toContainText("待确认");
		await expect(page.locator("tbody tr", { hasText: decoy })).toBeVisible();

		// Search narrows: the email search is debounced ~300ms; the decoy row
		// leaves the table while the target's stays.
		await page.getByLabel("按邮箱搜索…").fill(target);
		await expect(page.locator("tbody tr", { hasText: decoy })).toHaveCount(0, {
			timeout: 5000,
		});
		await expect(row).toHaveCount(1);

		// Remove the target through the confirm dialog.
		page.once("dialog", (dialog) => dialog.accept());
		await row.getByRole("button", { name: /移除/ }).click();
		await expect(row).toHaveCount(0, { timeout: 5000 });

		// The backend agrees: only the target is gone, the decoy remains.
		const admin = await request.post("/api/admin/login", {
			form: { username: "admin", password: "admin123" },
		});
		expect(admin.status()).toBe(200);
		const adminH = {
			Authorization: `Bearer ${((await admin.json()) as { access_token: string }).access_token}`,
		};
		const gone = await request.get("/api/admin/newsletter/subscribers", {
			headers: adminH,
			params: { q: target },
		});
		expect(gone.status()).toBe(200);
		expect((await gone.json()) as { pagination: { total: number } }).toMatchObject({
			pagination: { total: 0 },
		});
		const kept = await request.get("/api/admin/newsletter/subscribers", {
			headers: adminH,
			params: { q: decoy },
		});
		expect((await kept.json()) as { pagination: { total: number } }).toMatchObject({
			pagination: { total: 1 },
		});
	});
});
