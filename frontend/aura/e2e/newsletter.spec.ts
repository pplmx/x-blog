/**
 * Guest email newsletter journey (DEC-351, TASK-401).
 *
 * The anonymous "email me new posts" on-ramp: a visitor subscribes an address
 * from the footer form, the backend mails a double opt-in confirmation link
 * (via the SMTP sink `just e2e` stands up), clicking it activates the
 * subscription, and a newly published post sends the subscriber ONE newsletter
 * email deep-linked to the post. Unsubscribing via the emailed link flips the
 * consent off idempotently, so a later publish emails nothing.
 *
 * Uses the live backend seeded by the justfile e2e task + the Nuxt dev server.
 * Skipped when no SMTP sink is up (mirrors the guest reply-email journey).
 */

import { readFileSync } from "node:fs";

import { type APIRequestContext, expect, test } from "@playwright/test";

const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "admin123";

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

async function adminToken(request: APIRequestContext): Promise<string> {
	const res = await request.post("/api/admin/login", {
		form: { username: ADMIN_USERNAME, password: ADMIN_PASSWORD },
	});
	expect(res.status()).toBe(200);
	return ((await res.json()) as { access_token: string }).access_token;
}

let counter = 0;
function freshEmail(): string {
	counter += 1;
	return `newsletter-${Date.now()}-${counter}@example.com`;
}

test.describe("Guest newsletter (DEC-351)", () => {
	test.skip(() => !!process.env.CI_RESTRICTED, "full journey requires admin publish");

	test("footer subscribe -> confirm -> one email per post -> unsubscribe stops mail", async ({
		page,
		request,
	}) => {
		test.skip(!(await smtpIsUp(request)), "requires the e2e SMTP sink");

		const adminTok = await adminToken(request);
		const adminH = { Authorization: `Bearer ${adminTok}` };
		const uid = Date.now();
		const address = freshEmail();

		// Subscribe from the footer form on the home page.
		await page.goto("/");
		const form = page.locator("form", { has: page.locator("#newsletter-email") });
		await form.locator("#newsletter-email").fill(address);
		await form.locator("button[type=submit]").click();

		// The backend replies with one generic message (no oracle); the field
		// clears and the confirmation email (carrying the token link) lands.
		await expect(form.locator("#newsletter-email")).toHaveValue("", { timeout: 10000 });
		const [confirmMail] = messagesFromSink(address);
		expect(confirmMail).toBeDefined();
		const confirmToken = /newsletter\/confirm\?token=([A-Za-z0-9_-]+)/.exec(
			confirmMail?.text ?? "",
		);
		expect(confirmToken).not.toBeNull();

		// Clicking the confirmation link activates the address (UI journey).
		const token = String(confirmToken?.[1] ?? "");
		await page.goto(`/newsletter/confirm?token=${token}`);
		await expect(page.locator("body")).toContainText("订阅成功", { timeout: 10000 });

		// A newly published post emails the subscriber exactly once.
		const post = await request.post("/api/posts", {
			headers: adminH,
			data: {
				title: `Newsletter post ${uid}`,
				slug: `newsletter-e2e-${uid}`,
				content: "# Hello newsletter",
				published: true,
			},
		});
		expect(post.status()).toBe(201);
		const newsletters = messagesFromSink(address).filter((m) => m.subject.startsWith("新文章发布"));
		expect(newsletters).toHaveLength(1);
		expect(newsletters[0].text).toContain(`/posts/newsletter-e2e-${uid}`);

		// Unsubscribing via the emailed link flips consent off idempotently.
		const unsubToken = /newsletter\/unsubscribe\?token=([A-Za-z0-9_-]+)/.exec(newsletters[0].text);
		expect(unsubToken).not.toBeNull();
		await page.goto(`/newsletter/unsubscribe?token=${String(unsubToken?.[1] ?? "")}`);
		await expect(page.locator("body")).toContainText("已取消订阅", { timeout: 10000 });

		// A second publish emails nothing more.
		const post2 = await request.post("/api/posts", {
			headers: adminH,
			data: {
				title: `Newsletter post 2 ${uid}`,
				slug: `newsletter-e2e-2-${uid}`,
				content: "# Second",
				published: true,
			},
		});
		expect(post2.status()).toBe(201);
		const after = messagesFromSink(address).filter((m) => m.subject.startsWith("新文章发布"));
		expect(after).toHaveLength(1); // still just the first
	});

	test("digest cadence: a weekly subscriber gets no per-post email", async ({ page, request }) => {
		test.skip(!(await smtpIsUp(request)), "requires the e2e SMTP sink");

		const adminTok = await adminToken(request);
		const adminH = { Authorization: `Bearer ${adminTok}` };
		const uid = Date.now();
		const address = freshEmail();

		// Subscribe opting into the weekly digest from the footer form.
		await page.goto("/");
		const form = page.locator("form", { has: page.locator("#newsletter-email") });
		await form.locator("#newsletter-email").fill(address);
		await form.locator("input[type=checkbox]").check();
		await form.locator("button[type=submit]").click();
		await expect(form.locator("#newsletter-email")).toHaveValue("", { timeout: 10000 });

		// Confirm; the cadence box shows the server-truth (checked = weekly).
		const [confirmMail] = messagesFromSink(address);
		const confirmToken = /newsletter\/confirm\?token=([A-Za-z0-9_-]+)/.exec(
			confirmMail?.text ?? "",
		);
		expect(confirmToken).not.toBeNull();
		await page.goto(`/newsletter/confirm?token=${String(confirmToken?.[1] ?? "")}`);
		await expect(page.locator("body")).toContainText("订阅成功", { timeout: 10000 });
		// Scope to <main> (the confirm card): the site footer's newsletter form
		// also renders an `input[type=checkbox]` (the weekly-cadence opt-in), so
		// a bare `input[type=checkbox]` locator is ambiguous across the page and
		// strict-mode fails even when the card's box is correctly checked.
		await expect(page.locator("main").getByRole("checkbox")).toBeChecked({
			timeout: 5000,
		});

		// A publish emails the per-post subscriber but never this weekly one.
		const post = await request.post("/api/posts", {
			headers: adminH,
			data: {
				title: `Newsletter weekly ${uid}`,
				slug: `newsletter-weekly-${uid}`,
				content: "# Weekly",
				published: true,
			},
		});
		expect(post.status()).toBe(201);
		const newsletters = messagesFromSink(address).filter((m) => m.subject.startsWith("新文章发布"));
		expect(newsletters).toHaveLength(0);
	});
});
