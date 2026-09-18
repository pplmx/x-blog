/**
 * Guest email thread-follow journey (DEC-427, TASK-438).
 *
 * Thread-follow was reader-gated (DEC-078), so a visitor who just wants to
 * follow ONE discussion by email had no on-ramp but registering. This journey:
 * on a public post's comment header, a guest enters an email and subscribes
 * (double opt-in, no address oracle); the SMTP sink carries the confirmation
 * email; the guest opens the confirm link in-browser, which flips the consent
 * on; a new comment (posted by someone else and approved by the author) fans
 * out the thread email to the confirmed address; the one-click unsubscribe
 * link stops all further thread mail. Uses the live backend seeded by the
 * justfile e2e task + the Nuxt dev server. Skipped when no SMTP sink is up.
 */

import { readFileSync } from "node:fs";

import { type APIRequestContext, expect, test } from "@playwright/test";

const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "admin123";

const SINK_FILE = "/tmp/x-blog-smtp-sink.jsonl";

/** The latest SMTP-sink record addressed to ``email`` (or null). */
function messageFromSink(email: string): { to: string; subject: string; text: string } | null {
	let latest: { to: string; subject: string; text: string } | null = null;
	for (const line of readFileSync(SINK_FILE, "utf8").split("\n")) {
		if (!line.trim()) continue;
		const record = JSON.parse(line) as { to: string; subject: string; text: string };
		if (record.to !== email) continue;
		latest = record;
	}
	return latest;
}

function messagesTo(email: string): { to: string; subject: string; text: string }[] {
	return readFileSync(SINK_FILE, "utf8")
		.split("\n")
		.filter((l) => l.trim() && (JSON.parse(l) as { to: string }).to === email)
		.map((l) => JSON.parse(l));
}

/** True when the backend under test can actually send email (the e2e SMTP sink
 *  from `just e2e` sets SMTP), same probe as the reply-email journey. */
async function smtpIsUp(request: APIRequestContext): Promise<boolean> {
	const resp = await request.post("/api/reader/password-reset/request", {
		data: { email: "sink-probe@example.com" },
	});
	return resp.status() === 202 && resp.status() < 500;
}

let counter = 0;
function freshEmail(): string {
	counter += 1;
	return `guest-thread-${Date.now()}-${counter}@example.com`;
}

async function adminToken(request: APIRequestContext): Promise<string> {
	const res = await request.post("/api/admin/login", {
		form: { username: ADMIN_USERNAME, password: ADMIN_PASSWORD },
	});
	expect(res.status()).toBe(200);
	return ((await res.json()) as { access_token: string }).access_token;
}

test.describe("Guest email thread-follow (TASK-438)", () => {
	test.skip(() => !!process.env.CI_RESTRICTED, "full journey requires admin publish");

	test("guest subscribes by email, confirms, gets thread mail, then unsubscribes", async ({
		page,
		request,
	}) => {
		test.skip(!(await smtpIsUp(request)), "requires the e2e SMTP sink");

		const adminTok = await adminToken(request);
		const adminH = { Authorization: `Bearer ${adminTok}` };
		const uid = Date.now();
		const guestEmail = freshEmail();
		const postTitle = `Guest thread ${uid}`;
		const postSlug = `guest-thread-e2e-${uid}`;

		// A public post.
		const post = await request.post("/api/posts", {
			headers: adminH,
			data: {
				title: postTitle,
				slug: postSlug,
				content: "# Hello",
				published: true,
			},
		});
		expect(post.status()).toBe(201);
		const postId = ((await post.json()) as { id: number }).id;

		// A guest on the post page subscribes the thread by email (the compact
		// form in the comment header).
		await page.goto(`/posts/${postSlug}`);
		const commentSection = page.locator("section").filter({ hasText: "评论" }).first();
		await commentSection.waitFor({ state: "visible" });
		await commentSection.getByPlaceholder("you@example.com").fill(guestEmail);
		await commentSection.getByRole("button", { name: "订阅" }).click();
		// No-oracle response: only "check your inbox".
		await expect(commentSection).toContainText("请查收邮箱确认订阅");

		// The double-opt-in confirmation email carries the per-subscription token.
		const confirmRecord = messageFromSink(guestEmail);
		expect(confirmRecord).toBeDefined();
		expect(confirmRecord?.subject).toBe(`确认订阅《${postTitle}》的讨论`);
		const confirmMatch = /comment-subscribe\/confirm\?token=([A-Za-z0-9_-]+)/.exec(
			confirmRecord?.text ?? "",
		);
		expect(confirmMatch).not.toBeNull();
		const confirmToken = String(confirmMatch?.[1] ?? "");

		// Opening the emailed link is the consent grant: the page flips the
		// subscription confirmed.
		await page.goto(`/comment-subscribe/confirm?token=${confirmToken}`);
		await expect(page.locator("body")).toContainText(
			"这篇讨论每当有新评论通过审核时，你都会收到一封邮件。",
			{
				timeout: 10000,
			},
		);

		// A DIFFERENT guest comments; the author approves it → the confirmed
		// follower gets one thread email (deep link + one-click unsubscribe).
		const comment = await request.post(`/api/comments/post/${postId}`, {
			data: {
				nickname: "OtherGuest",
				email: freshEmail(),
				content: "great discussion",
			},
		});
		expect(comment.status()).toBe(201);
		const commentId = ((await comment.json()) as { id: number }).id;
		const approve = await request.patch(`/api/comments/${commentId}/approve`, {
			headers: adminH,
			data: { approved: true },
		});
		expect(approve.status()).toBe(200);

		const threadRecord = messageFromSink(guestEmail);
		expect(threadRecord).toBeDefined();
		expect(threadRecord?.subject).toBe(`《${postTitle}》有新评论`);
		expect(threadRecord?.text).toContain(`/posts/${postSlug}#comment-${commentId}`);
		const unsubMatch = /comment-subscribe\/unsubscribe\?token=([A-Za-z0-9_-]+)/.exec(
			threadRecord?.text ?? "",
		);
		expect(unsubMatch).not.toBeNull();
		const unsubToken = String(unsubMatch?.[1] ?? "");

		// The one-click unsubscribe link stops future thread mail.
		await page.goto(`/comment-subscribe/unsubscribe?token=${unsubToken}`);
		await expect(page.locator("body")).toContainText("已取消订阅", { timeout: 10000 });
		// Note `messageFromSink` reads the latest; count ALL messages to assert
		// nothing NEW arrives after the unsubscribe.
		expect(messagesTo(guestEmail).length).toBe(2); // confirm + first thread

		// A second approved comment after unsubscribe sends nothing more.
		const comment2 = await request.post(`/api/comments/post/${postId}`, {
			data: {
				nickname: "OtherGuest2",
				email: freshEmail(),
				content: "one more",
			},
		});
		expect(comment2.status()).toBe(201);
		const comment2Id = ((await comment2.json()) as { id: number }).id;
		const approve2 = await request.patch(`/api/comments/${comment2Id}/approve`, {
			headers: adminH,
			data: { approved: true },
		});
		expect(approve2.status()).toBe(200);

		expect(messagesTo(guestEmail).length).toBe(2);
	});

	test("opting into a weekly summary on the confirm page stops per-comment mail", async ({
		page,
		request,
	}) => {
		test.skip(!(await smtpIsUp(request)), "requires the e2e SMTP sink");

		const adminTok = await adminToken(request);
		const adminH = { Authorization: `Bearer ${adminTok}` };
		const uid = Date.now();
		const guestEmail = freshEmail();
		const postSlug = `guest-thread-weekly-e2e-${uid}`;

		const post = await request.post("/api/posts", {
			headers: adminH,
			data: {
				title: `Weekly thread ${uid}`,
				slug: postSlug,
				content: "# Hello",
				published: true,
			},
		});
		expect(post.status()).toBe(201);
		const postId = ((await post.json()) as { id: number }).id;

		// Guest subscribes the thread by email on the post page.
		await page.goto(`/posts/${postSlug}`);
		const commentSection = page.locator("section").filter({ hasText: "评论" }).first();
		await commentSection.waitFor({ state: "visible" });
		await commentSection.getByPlaceholder("you@example.com").fill(guestEmail);
		await commentSection.getByRole("button", { name: "订阅" }).click();
		await expect(commentSection).toContainText("请查收邮箱确认订阅");

		const confirmRecord = messageFromSink(guestEmail);
		expect(confirmRecord).toBeDefined();
		const confirmMatch = /comment-subscribe\/confirm\?token=([A-Za-z0-9_-]+)/.exec(
			confirmRecord?.text ?? "",
		);
		expect(confirmMatch).not.toBeNull();
		const confirmToken = String(confirmMatch?.[1] ?? "");

		// Confirm AND flip to the weekly cadence on the confirm page (DEC-429):
		// the checkbox seeds from the server answer, then trips the token-gated
		// cadence endpoint.
		await page.goto(`/comment-subscribe/confirm?token=${confirmToken}`);
		await expect(page.locator("body")).toContainText(
			"这篇讨论每当有新评论通过审核时，你都会收到一封邮件。",
			{
				timeout: 10000,
			},
		);
		// Scope to main: the footer newsletter form carries its own cadence
		// checkbox, so the page-level role locator would be ambiguous.
		await page.locator("main").getByRole("checkbox").check();

		// A DIFFERENT guest comments and the author approves: a weekly follower
		// gets NO per-comment email — only the earlier confirm remains.
		const comment = await request.post(`/api/comments/post/${postId}`, {
			data: {
				nickname: "WeeklyOther",
				email: freshEmail(),
				content: "digest only please",
			},
		});
		expect(comment.status()).toBe(201);
		const commentId = ((await comment.json()) as { id: number }).id;
		const approve = await request.patch(`/api/comments/${commentId}/approve`, {
			headers: adminH,
			data: { approved: true },
		});
		expect(approve.status()).toBe(200);

		expect(messagesTo(guestEmail).length).toBe(1); // the confirm email only
	});
});
