/**
 * Reader email-change journey (DEC-357, TASK-404).
 *
 * A signed-in reader asks to switch login email from the account settings page
 * (current password + new address), the backend mails a single-use verification
 * link to the NEW address (via the SMTP sink `just e2e` stands up), and clicking
 * it swaps the email, bumps token_version (revoking the old session) and signs
 * the reader in under the new address. Afterwards the old email no longer
 * authenticates and the new one does — the reader who changed address is no
 * longer stranded on a dead inbox.
 *
 * Skipped when no SMTP sink is up (mirrors the guest newsletter journey).
 */

import { readFileSync } from "node:fs";

import { type APIRequestContext, expect, test } from "@playwright/test";

const PASSWORD = "e2epass123";

const SINK_FILE = "/tmp/x-blog-smtp-sink.jsonl";

/** All SMTP-sink records addressed to ``email``, oldest first. */
function messagesFromSink(email: string): { to: string; subject: string; text: string }[] {
	const out: { to: string; subject: string; text: string }[] = [];
	for (const line of readFileSync(SINK_FILE, "utf8").split("\n")) {
		if (!line.trim()) continue;
		const record = JSON.parse(line) as { to: string; subject: string; text: string };
		if (record.to === email) out.push(record);
	}
	return out;
}

/** True when the backend under test can actually send email (the e2e SMTP sink
 *  from `just e2e` sets SMTP), same probe as the reply-email journey. */
async function smtpIsUp(request: APIRequestContext): Promise<boolean> {
	const resp = await request.post("/api/reader/password-reset/request", {
		data: { email: "sink-probe@example.com" },
	});
	return resp.status() === 202;
}

let emailCounter = 0;
function freshEmail(): string {
	emailCounter += 1;
	return `emailchange-${Date.now()}-${emailCounter}@example.com`;
}

test.describe("Reader email change (DEC-357)", () => {
	test("swaps the sign-in email via the emailed link", async ({ page, request }) => {
		test.skip(!(await smtpIsUp(request)), "requires the e2e SMTP sink");

		const oldEmail = freshEmail();
		const reg = await request.post("/api/reader/register", {
			data: { email: oldEmail, password: PASSWORD, display_name: "Switcher" },
		});
		expect(reg.status()).toBe(201);

		// Sign in with the old email.
		await page.goto("/login");
		await page.locator('input[type="email"]').fill(oldEmail);
		await page.locator('input[type="password"]').fill(PASSWORD);
		await page.locator("form").press("Enter");
		await page.waitForURL("**/bookmarks");

		// Request the change from the account settings email section. The page
		// has several sections with password inputs, so scope to the email
		// section by its heading.
		await page.goto("/account");
		await expect(page.locator("h1", { hasText: "账号设置" })).toBeVisible({ timeout: 10000 });
		const newEmail = freshEmail();
		const emailSection = page.locator("section", {
			has: page.getByRole("heading", { name: "修改登录邮箱" }),
		});
		// input[type=email][0] is the readonly current email; [1] is the new one.
		await emailSection.locator('input[type="email"]').nth(1).fill(newEmail);
		await emailSection.locator('input[type="password"]').fill(PASSWORD);
		await emailSection.getByRole("button", { name: "发送验证链接" }).click();
		await expect(emailSection.locator("text=验证链接已发送")).toBeVisible({ timeout: 5000 });

		// The verification mail goes to the NEW address; poll the sink for it
		// (the backend sends before responding, but the sink write can lag on a
		// busy CI worker — same retry pattern as password-reset.spec).
		await expect.poll(() => messagesFromSink(newEmail)[0], { timeout: 10_000 }).toBeDefined();
		const mail = messagesFromSink(newEmail)[0];
		if (mail === undefined) throw new Error(`no email-change mail to ${newEmail}`);
		expect(mail.subject).toContain("确认你新的");
		const linkMatch = /email-change\?token=([A-Za-z0-9_-]+)/.exec(mail.text);
		expect(linkMatch).not.toBeNull();
		const token = String(linkMatch?.[1] ?? "");

		// Opening the link swaps the email and auto-signs the reader in.
		await page.goto(`/email-change?token=${token}`);
		await page.waitForURL("**/account", { timeout: 10000 });

		// The account settings now show the NEW address as the sign-in email.
		await expect(page.locator("h1", { hasText: "账号设置" })).toBeVisible({ timeout: 10000 });
		const updatedSection = page.locator("section", {
			has: page.getByRole("heading", { name: "修改登录邮箱" }),
		});
		await expect(updatedSection.locator('input[type="email"]').nth(0)).toHaveValue(newEmail, {
			timeout: 5000,
		});

		// The old email no longer authenticates; the new one does.
		const oldLogin = await request.post("/api/reader/login", {
			data: { email: oldEmail, password: PASSWORD },
		});
		expect(oldLogin.status()).toBe(401);
		const newLogin = await request.post("/api/reader/login", {
			data: { email: newEmail, password: PASSWORD },
		});
		expect(newLogin.status()).toBe(200);
	});
});
