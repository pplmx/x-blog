/**
 * Admin weekly-digest overview + preview journey (DEC-423, TASK-436).
 *
 * The digest's backend machinery (send_weekly_digest with advisory lock,
 * idempotent stamps, dry_run summary) had no operator reading surface: an
 * admin could not see who opted into the weekly cadence, when the last one
 * went out, or what the next window holds. This journey exercises the panel
 * on /admin/newsletter: a confirmed digest_weekly guest subscriber moves the
 * guest counter, and a "preview" (send-weekly?dry_run=true) surfaces the
 * dry-run summary without sending any mail.
 *
 * The guest is confirmed the honest way — through the SMTP-sink confirmation
 * link (same journey as newsletter.spec.ts) — so the overview count reflects
 * a real double-opt-in subscriber. Skipped when the sink is down.
 */

import { readFileSync } from "node:fs";

import { type APIRequestContext, expect, test } from "@playwright/test";

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

async function loginAdmin(page: import("@playwright/test").Page) {
	await page.goto("/admin/login");
	await page.fill('input[type="text"]', "admin");
	await page.fill('input[type="password"]', "admin123");
	await page.click('button[type="submit"]');
	await page.waitForURL("**/admin/posts");
}

/** True when the backend under test can actually send email (the e2e SMTP sink
 *  from `just e2e` sets SMTP), same probe as the reply-email journey. */
async function smtpIsUp(request: APIRequestContext): Promise<boolean> {
	const resp = await request.post("/api/reader/password-reset/request", {
		data: { email: "digest-sink-probe@example.com" },
	});
	return resp.status() === 202;
}

let counter = 0;
function freshEmail(): string {
	counter += 1;
	return `admin-digest-${Date.now()}-${counter}@example.com`;
}

test.describe("Admin weekly-digest panel (DEC-423)", () => {
	test("overview counter reflects a confirmed digest guest; preview is a dry run", async ({
		page,
		request,
	}) => {
		test.skip(!(await smtpIsUp(request)), "requires the e2e SMTP sink");

		// Subscribe a guest on the weekly cadence through the public flow, then
		// confirm it through the SMTP-sink link — the honest double opt-in.
		const email = freshEmail();
		const sub = await request.post("/api/newsletter/subscribe", {
			data: { email, digest_weekly: true },
		});
		expect(sub.status()).toBe(202);

		const [confirmMail] = messagesFromSink(email);
		expect(confirmMail).toBeDefined();
		const confirmToken = /newsletter\/confirm\?token=([A-Za-z0-9_-]+)/.exec(
			confirmMail?.text ?? "",
		);
		expect(confirmToken).not.toBeNull();
		const confirm = await request.post("/api/newsletter/confirm", {
			data: { token: String(confirmToken?.[1] ?? "") },
		});
		expect(confirm.status()).toBe(200);

		await loginAdmin(page);
		await page.goto("/admin/newsletter");

		// The digest panel renders with the confirmed guest counted — the
		// guest_digest_subscribers figure is at least 1 (parallel runs may
		// seed more).
		const panel = page.getByRole("region", { name: "每周摘要（周报）" });
		await expect(panel).toBeVisible({ timeout: 10000 });
		const guestDt = panel.locator("dl > div", { hasText: "游客订阅" }).locator("dd").first();
		await expect(guestDt).toHaveText(/\d+/);
		expect(Number((await guestDt.textContent())?.trim())).toBeGreaterThanOrEqual(1);

		// The address itself shows the weekly-cadence chip in the table.
		const row = page.locator("tbody tr", { hasText: email });
		await expect(row).toContainText("每周摘要");

		// Preview (dry run) surfaces the summary without sending anything.
		await panel.getByRole("button", { name: /预览/ }).click();
		await expect(panel.getByText("预览完成（未发送）")).toBeVisible({
			timeout: 10000,
		});
		// The summary reports the just-confirmed guest among the dry-run
		// recipients (>= 1: a parallel run may confirm more). Note it is a
		// different quantity than the panel's overview count: the overview
		// guest figure is the opt-in base (all confirmed digest_weekly
		// addresses), while the dry-run "游客订阅" line counts only recipients
		// with eligible posts in their personal window — the rest land in
		// "跳过" — so it can legitimately be smaller. And no mail was
		// delivered (emails_sent stays 0 in a preview).
		const summaryGuest = panel.locator("text=游客订阅:").first().locator("..");
		await expect(summaryGuest).toContainText(/\d+/);
		const summaryGuestNum = Number((await summaryGuest.textContent())?.match(/\d+/)?.[0] ?? 0);
		expect(summaryGuestNum).toBeGreaterThanOrEqual(1);
		await expect(panel).not.toContainText("已发送 1 封邮件");
	});
});
