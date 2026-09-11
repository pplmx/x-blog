/**
 * Reader password-reset UI journey (DEC-286, TASK-371).
 *
 * Both the browser-observable surface and, when the e2e SMTP sink is running,
 * the full happy path: request a reset, get the single-use token from the
 * dumped email, redeem it in the browser and land signed-in on /account with a
 * new password that works. The sink (scripts/smtp_sink.py, started by `just
 * e2e`) writes each delivered message to /tmp/x-blog-smtp-sink.jsonl; the
 * non-happy-path cases pin the deterministic render/error surfaces.
 */

import { readFileSync } from "node:fs";

import { expect, test } from "@playwright/test";

const SINK_FILE = "/tmp/x-blog-smtp-sink.jsonl";
const PASSWORD = "e2epass123";

let emailCounter = 0;
function freshEmail(): string {
	emailCounter += 1;
	return `pwreset-${Date.now()}-${emailCounter}@example.com`;
}

/** The reset link for the newest message addressed to `email`, or null. */
function resetTokenFromSink(email: string): string | null {
	let latest: string | null = null;
	for (const line of readFileSync(SINK_FILE, "utf8").split("\n")) {
		if (!line.trim()) continue;
		const record = JSON.parse(line) as { to: string; text: string };
		if (record.to !== email) continue;
		// `text` is the base64-decoded plain-text body (the sink decodes it so
		// the emailed deep link is greppable).
		const match = /\/reset-password\?token=([^\s")&]+)/.exec(record.text);
		if (match?.[1]) latest = match[1];
	}
	return latest;
}

async function registerReader(
	request: import("@playwright/test").APIRequestContext,
	email: string,
): Promise<{ access_token: string; email: string }> {
	const resp = await request.post("/api/reader/register", {
		data: { email, password: PASSWORD, display_name: "E2E Password Reset" },
	});
	expect(resp.status()).toBe(201);
	const body = (await resp.json()) as { access_token: string };
	return { access_token: body.access_token, email };
}

/**
 * True when the backend under test can actually send email (the e2e SMTP sink
 * from `just e2e` configures SMTP). Probed at runtime — Playwright never sees
 * the backend's env — so a bare `pnpm test:e2e` (no sink) skips the
 * mail-dependent cases instead of failing them, deterministically.
 */
async function smtpIsUp(request: import("@playwright/test").APIRequestContext): Promise<boolean> {
	const resp = await request.post("/api/reader/password-reset/request", {
		data: { email: "sink-probe@example.com" },
	});
	return resp.status() === 202 && resp.status() < 500;
}

test.describe("Reader password-reset UI", () => {
	test("login offers the forgot-password entry and it renders the request form", async ({
		page,
	}) => {
		await page.goto("/login");
		await expect(page.locator("a", { hasText: "忘记密码" }).first()).toBeVisible();
		await page.locator("a", { hasText: "忘记密码" }).first().click();
		await page.waitForURL("**/forgot-password");
		await expect(page.locator('input[type="email"]')).toBeVisible();
	});

	test("forgot-password submits a known email and lands the generic-success screen", async ({
		page,
	}) => {
		// Requires the e2e SMTP sink (just e2e): a real email gets the 202
		// generic-success screen — no leak of whether the address exists.
		test.skip(!(await smtpIsUp(page.request)), "requires the e2e SMTP sink");
		const email = freshEmail();
		await registerReader(page.request, email);
		await page.goto("/forgot-password");
		await page.locator('input[type="email"]').fill(email);
		await page.locator('button[type="submit"]').click();
		await expect(page.getByRole("status")).toContainText("如果该邮箱已注册");
		// And a reset email really landed in the sink for that address.
		await expect.poll(() => resetTokenFromSink(email)).not.toBeNull();
	});

	test("forgot-password reports the email-service 503 when SMTP is unconfigured", async ({
		page,
	}) => {
		// Without an SMTP host the backend maps the request to an
		// account-agnostic 503; the page must report that real infra failure
		// instead of a fake "sent". Skipped under `just e2e` (sink configures
		// SMTP), where the generic-success test above runs instead.
		test.skip(await smtpIsUp(page.request), "requires SMTP unconfigured");
		await page.goto("/forgot-password");
		await page.locator('input[type="email"]').fill("reset-503@example.com");
		await page.locator('button[type="submit"]').click();
		await expect(page.getByRole("alert")).toContainText("邮件服务暂不可用");
	});

	test("full reset journey: request → token from email → redeem → auto-login", async ({
		page,
		request,
	}) => {
		test.skip(!(await smtpIsUp(request)), "requires the e2e SMTP sink");
		// Register, then request a reset for the same address.
		const { access_token, email } = await registerReader(request, freshEmail());
		const req = await request.post("/api/reader/password-reset/request", {
			data: { email },
		});
		expect(req.status()).toBe(202);

		// The single-use token arrives by mail (via the e2e SMTP sink).
		await expect.poll(() => resetTokenFromSink(email), { timeout: 10_000 }).toBeTruthy();
		// expect.poll resolves to the matcher outcome, not the value — read the
		// token again once the poll confirms it has arrived.
		const token = resetTokenFromSink(email);
		expect(token).toBeTruthy();

		// Redeem in the browser: set a new password from the emailed deep link.
		const newPassword = "newpass456";
		await page.goto(`/reset-password?token=${token}`);
		const inputs = page.locator('input[type="password"]');
		await inputs.nth(0).fill(newPassword);
		await inputs.nth(1).fill(newPassword);
		await page.locator('button[type="submit"]').click();

		// Auto-login adopted the fresh session and routed to /account.
		await page.waitForURL("**/account");
		await expect(page).toHaveURL(/\/account/);

		// Old password is dead; the new one signs in.
		const oldLogin = await request.post("/api/reader/login", {
			data: { email, password: PASSWORD },
		});
		expect(oldLogin.status()).toBe(401);
		const newLogin = await request.post("/api/reader/login", {
			data: { email, password: newPassword },
		});
		expect(newLogin.status()).toBe(200);

		// The pre-reset session was revoked too (token_version bump).
		const stale = await request.get("/api/reader/me", {
			headers: { Authorization: `Bearer ${access_token}` },
		});
		expect(stale.status()).toBe(401);
	});

	test("reset-password without a token shows the invalid-link state", async ({ page }) => {
		await page.goto("/reset-password");
		await expect(page.getByRole("status")).toContainText("重置链接无效或已过期");
	});

	test("reset-password with a token renders the new-password form", async ({ page }) => {
		// Server-rendered with a dummy token and no backend call: the form is
		// visible with two password fields (redeeming a real token is covered
		// by the full-journey test above + the backend suite).
		await page.goto("/reset-password?token=abc.def.ghi");
		await expect(page.locator('input[type="password"]')).toHaveCount(2);
	});
});
