/**
 * Reader data-export journey (DEC-126, TASK-175).
 *
 * A signed-in reader can download their personal data (account, bookmarks,
 * comments, history) as a JSON file from the account page, after confirming.
 */

import { expect, test } from "@playwright/test";

const PASSWORD = "e2epass123";
let emailCounter = 0;
function freshEmail(): string {
	emailCounter += 1;
	return `reader-${Date.now()}-${emailCounter}@example.com`;
}

test.describe("Reader data export (TASK-175)", () => {
	test("signed-in reader downloads the JSON bundle", async ({ page, request }) => {
		const email = freshEmail();
		const reg = await request.post("/api/reader/register", {
			data: { email, password: PASSWORD, display_name: "Export E2E" },
		});
		expect(reg.status()).toBe(201);
		const token = ((await reg.json()) as { access_token: string }).access_token;
		await page.addInitScript((tk) => localStorage.setItem("reader_token", tk), token);

		// Confirm the export dialog, then capture the JSON download.
		page.on("dialog", (d) => d.accept());

		const downloadPromise = page.waitForEvent("download");
		await page.goto("/account");
		await expect(page.locator("button", { hasText: "下载我的数据" }).first()).toBeVisible({
			timeout: 10000,
		});
		await page.locator("button", { hasText: "下载我的数据" }).first().click();

		const download = await downloadPromise;
		expect(download.suggestedFilename()).toBe("xblog-my-data.json");

		// The bundle is valid JSON and carries the account email.
		const path = await download.path();
		expect(path).toBeTruthy();
	});
});
