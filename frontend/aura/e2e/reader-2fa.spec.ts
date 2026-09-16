/**
 * Reader TOTP two-factor authentication journey (round 364, DEC-401).
 *
 * A reader enables 2FA from /account, and from then on every login stops at a
 * second "enter your 6-digit code" step: a wrong code is rejected and stays on
 * the step, the right code (from an authenticator) completes the sign-in, and
 * turning 2FA back off restores the single-step login. The enrollment QR + the
 * base32 backup secret are rendered by the /account UI; the spec reads the
 * displayed secret and computes real RFC-6238 TOTP codes with the same
 * SHA1/30s/6-digit scheme the backend verifies.
 */

import { createHmac } from "node:crypto";

import { expect, test } from "@playwright/test";

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Decode(input: string): Buffer {
	const clean = input.replace(/[=\s]/g, "").toUpperCase();
	let bits = 0;
	let value = 0;
	const out: number[] = [];
	for (const ch of clean) {
		value = (value << 5) | BASE32.indexOf(ch);
		bits += 5;
		if (bits >= 8) {
			out.push((value >>> (bits - 8)) & 0xff);
			bits -= 8;
		}
	}
	return Buffer.from(out);
}

/** RFC 6238 TOTP (SHA-1, 30s step, 6 digits) at a Unix `counter`. */
function totpAt(secret: string, counter: number): string {
	const key = base32Decode(secret);
	const buf = Buffer.alloc(8);
	buf.writeBigUInt64BE(BigInt(Math.floor(counter)));
	const h = createHmac("sha1", key).update(buf).digest();
	const off = h[h.length - 1] & 0x0f;
	const bin = ((h[off]! & 0x7f) << 24) | (h[off + 1]! << 16) | (h[off + 2]! << 8) | h[off + 3]!;
	return (bin % 1_000_000).toString().padStart(6, "0");
}

function currentTotp(secret: string): string {
	return totpAt(secret, Date.now() / 1000 / 30);
}

let emailCounter = 0;
function freshEmail(): string {
	emailCounter += 1;
	return `reader-${Date.now()}-${emailCounter}@example.com`;
}
const PASSWORD = "e2epass123";

async function registerReader(
	request: import("@playwright/test").APIRequestContext,
	email: string,
): Promise<{ access_token: string; reader_id: number; reader: Record<string, unknown> }> {
	const resp = await request.post("/api/reader/register", {
		data: { email, password: PASSWORD, display_name: "Two-Factor Reader" },
	});
	expect(resp.status()).toBe(201);
	const body = (await resp.json()) as {
		access_token: string;
		reader: { id: number } & Record<string, unknown>;
	};
	return { access_token: body.access_token, reader_id: body.reader.id, reader: body.reader };
}

async function signIn(
	page: import("@playwright/test").Page,
	session: { access_token: string; reader: Record<string, unknown> },
) {
	await page.addInitScript((s) => {
		localStorage.setItem("reader_token", s.access_token);
		localStorage.setItem("reader_profile", JSON.stringify(s.reader));
	}, session);
}

/** Enable 2FA via the API; returns the base32 secret (to generate codes). */
async function enableViaApi(
	request: import("@playwright/test").APIRequestContext,
	token: string,
): Promise<{ secret: string; otpauth_uri: string }> {
	const setup = await request.post("/api/reader/me/2fa/setup", {
		headers: { Authorization: `Bearer ${token}` },
	});
	expect(setup.status()).toBe(200);
	const body = (await setup.json()) as { secret: string; otpauth_uri: string };
	const enable = await request.post("/api/reader/me/2fa/enable", {
		headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
		// Enrollment requires the password too (a session alone must not be
		// able to register a factor — security review, DEC-401).
		data: { current_password: PASSWORD, code: currentTotp(body.secret) },
	});
	expect(enable.status()).toBe(200);
	return body;
}

/** Fill the login form and submit (password step, and then the code step). */
async function loginWithPassword(
	page: import("@playwright/test").Page,
	email: string,
	password: string,
) {
	await page.goto("/login");
	const loginForm = page.locator("form").first();
	await loginForm.locator('input[type="email"]').fill(email);
	await loginForm.locator('input[type="password"]').fill(password);
	await loginForm.press("Enter");
	// The second step's code input is what a 2FA reader lands on.
	const codeInput = page.locator('input[autocomplete="one-time-code"]');
	await codeInput.waitFor({ state: "visible", timeout: 10000 });
	return codeInput;
}

test.describe("TOTP two-factor authentication (DEC-401)", () => {
	test("enable via the /account UI → login needs a code; wrong rejected, right logs in; disable restores one step", async ({
		page,
		request,
	}) => {
		const session = await registerReader(request, freshEmail());

		// Enroll through the UI: the QR + backup secret render, and entering the
		// current authenticator code flips the flag on.
		await signIn(page, session);
		await page.goto("/account");
		await page.getByRole("button", { name: "开启两步验证" }).first().click();
		// The enrollment view shows the base32 backup secret as readable text
		// (a real browser would scan the QR; the secret is the same seed).
		const secret = (await page.locator("code").innerText()).trim();
		expect(secret.length).toBeGreaterThan(10);
		// Enrollment also asks for the current password (a session alone must
		// not be able to register a factor — the scope is the 2FA section, as
		// the password-change section above has its own password input).
		const twoFactorSection = page.locator("section").filter({ hasText: "两步验证" });
		await twoFactorSection.locator('input[autocomplete="current-password"]').fill(PASSWORD);
		await twoFactorSection.locator('input[inputmode="numeric"]').fill(currentTotp(secret));
		await page.getByRole("button", { name: "确认开启" }).click();
		await expect(page.getByText("已开启")).toBeVisible({ timeout: 5000 });
		// Server agrees.
		const me = await request.get("/api/reader/me", {
			headers: { Authorization: `Bearer ${session.access_token}` },
		});
		expect((await me.json()).two_factor_enabled).toBe(true);

		// Sign out and sign back in — login must stop at the code step.
		const codeInput = await loginWithPassword(page, session.reader.email as string, PASSWORD);
		// A wrong code is rejected by the server and STAYS on the step. Pressing
		// Enter INSIDE the code input submits its own form — a bare
		// `form.last()` would hit the footer newsletter form instead. The
		// rejection surfaces as an inline error (the backend's flat 401).
		await codeInput.fill("000000");
		await codeInput.press("Enter");
		await expect(page.locator('[role="alert"]').first()).toBeVisible({ timeout: 5000 });
		await expect(page.locator('input[autocomplete="one-time-code"]')).toBeVisible({
			timeout: 5000,
		});

		// The current code completes the sign-in.
		await codeInput.fill(currentTotp(secret));
		await codeInput.press("Enter");
		await page.waitForURL("**/bookmarks", { timeout: 10000 });
		await expect(page.getByText("收藏的文章", { exact: false }).first()).toBeVisible({
			timeout: 5000,
		});

		// Disable via the API (password + code) — login is single-step again.
		const disable = await request.post("/api/reader/me/2fa/disable", {
			headers: {
				Authorization: `Bearer ${session.access_token}`,
				"Content-Type": "application/json",
			},
			data: { current_password: PASSWORD, code: currentTotp(secret) },
		});
		expect(disable.status()).toBe(200);
		await page.goto("/login");
		const loginForm = page.locator("form").first();
		await loginForm.locator('input[type="email"]').fill(session.reader.email as string);
		await loginForm.locator('input[type="password"]').fill(PASSWORD);
		await loginForm.press("Enter");
		// No code input — straight to the site for the now-single-step reader.
		await page.waitForURL("**/bookmarks", { timeout: 10000 });
		await expect(page.locator('input[autocomplete="one-time-code"]')).toHaveCount(0);
	});

	test("a never-enabled reader logs in in one step and the /me flag stays off", async ({
		page,
		request,
	}) => {
		const session = await registerReader(request, freshEmail());
		// No enrollment happened — the /account 2FA section still offers Enable.
		await signIn(page, session);
		await page.goto("/account");
		await expect(page.getByRole("button", { name: "开启两步验证" }).first()).toBeVisible({
			timeout: 5000,
		});
		const me = await request.get("/api/reader/me", {
			headers: { Authorization: `Bearer ${session.access_token}` },
		});
		expect((await me.json()).two_factor_enabled).toBe(false);

		// Login lands straight on the authenticated page — no code step.
		await page.goto("/login");
		const loginForm = page.locator("form").first();
		await loginForm.locator('input[type="email"]').fill(session.reader.email as string);
		await loginForm.locator('input[type="password"]').fill(PASSWORD);
		await loginForm.press("Enter");
		await page.waitForURL("**/bookmarks", { timeout: 10000 });
		await expect(page.locator('input[autocomplete="one-time-code"]')).toHaveCount(0);
	});

	test("the public profile never leaks the 2FA flag (guest 404/no-envelope check)", async ({
		request,
	}) => {
		const session = await registerReader(request, freshEmail());
		await enableViaApi(request, session.access_token);
		const publicProfile = await request.get(`/api/readers/${session.reader_id}`);
		const profile = (await publicProfile.json()).profile as Record<string, unknown>;
		expect("two_factor_enabled" in profile).toBe(false);
		// The challenge login response carries only the mfa_token — no session.
		const challenge = await request.post("/api/reader/login", {
			data: { email: session.reader.email, password: PASSWORD },
		});
		const body = (await challenge.json()) as {
			two_factor_required: boolean;
			mfa_token: string;
			access_token: string | null;
		};
		expect(body.two_factor_required).toBe(true);
		expect(body.access_token).toBeFalsy();
		expect(body.mfa_token).toBeTruthy();
	});
});
