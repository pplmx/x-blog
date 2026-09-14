/**
 * Guest commenter reply-email journey (DEC-332, TASK-392).
 *
 * The comment form REQUIRES a guest to leave an email and it is stored on the
 * comment row, but until DEC-332 no dispatch path used it — a reply to an
 * anonymous comment notified nobody. This journey: a guest comments (with the
 * "email me when someone replies" consent) on a public post; the author
 * approves a reply written by a reader; the guest's STORED address receives
 * the reply email through the SMTP sink (the same sink the @-mention email
 * journey uses); the emailed unsubscribe link flips the consent off, so a
 * second approved reply sends nothing. Uses the live backend seeded by the
 * justfile e2e task + the Nuxt dev server. Skipped when no SMTP sink is up.
 */

import { readFileSync } from "node:fs";

import { type APIRequestContext, expect, test } from "@playwright/test";

const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "admin123";
const password = "e2epass123";

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

/** True when the backend under test can actually send email (the e2e SMTP sink
 *  from `just e2e` sets SMTP), same probe as the mention-email journey. */
async function smtpIsUp(request: APIRequestContext): Promise<boolean> {
	const resp = await request.post("/api/reader/password-reset/request", {
		data: { email: "sink-probe@example.com" },
	});
	return resp.status() === 202 && resp.status() < 500;
}

let counter = 0;
function freshEmail(): string {
	counter += 1;
	return `reply-email-${Date.now()}-${counter}@example.com`;
}

async function adminToken(request: APIRequestContext): Promise<string> {
	const res = await request.post("/api/admin/login", {
		form: { username: ADMIN_USERNAME, password: ADMIN_PASSWORD },
	});
	expect(res.status()).toBe(200);
	return ((await res.json()) as { access_token: string }).access_token;
}

test.describe("Guest commenter reply-email (TASK-392)", () => {
	test.skip(() => !!process.env.CI_RESTRICTED, "full journey requires admin publish");

	test("approved reply emails the opted-in guest, then unsubscribe stops future mail", async ({
		page,
		request,
	}) => {
		test.skip(!(await smtpIsUp(request)), "requires the e2e SMTP sink");

		const adminTok = await adminToken(request);
		const adminH = { Authorization: `Bearer ${adminTok}` };
		const uid = Date.now();
		const guestEmail = freshEmail();

		// A public post.
		const post = await request.post("/api/posts", {
			headers: adminH,
			data: {
				title: `Guest reply ${uid}`,
				slug: `guest-reply-e2e-${uid}`,
				content: "# Hello",
				published: true,
			},
		});
		expect(post.status()).toBe(201);
		const postId = ((await post.json()) as { id: number }).id;

		// The guest comments, opting into reply emails (the consent checkbox).
		const guest = await request.post(`/api/comments/post/${postId}`, {
			data: {
				nickname: "GuestUser",
				email: guestEmail,
				content: "nice post, keen to hear back",
				reply_notify_email: true,
			},
		});
		expect(guest.status()).toBe(201);
		const guestId = ((await guest.json()) as { id: number }).id;

		// Author approves the root comment so a reply is allowed.
		const approveRoot = await request.patch(`/api/comments/${guestId}/approve`, {
			headers: adminH,
			data: { approved: true },
		});
		expect(approveRoot.status()).toBe(200);

		// A DIFFERENT guest posts a reply (the "someone replied to you" case).
		const reply = await request.post(`/api/comments/post/${postId}`, {
			data: {
				nickname: "Replier",
				email: freshEmail(),
				content: "glad you liked it",
				parent_id: guestId,
			},
		});
		expect(reply.status()).toBe(201);
		const replyId = ((await reply.json()) as { id: number }).id;

		// Approving the reply fires the guest email synchronously.
		const approveReply = await request.patch(`/api/comments/${replyId}/approve`, {
			headers: adminH,
			data: { approved: true },
		});
		expect(approveReply.status()).toBe(200);

		// The guest's stored address holds the reply email, deep-linked to the
		// reply and carrying the per-comment unsubscribe token.
		const record = messageFromSink(guestEmail);
		expect(record).toBeDefined();
		expect(record?.subject).toBe("有人回复了你的评论");
		expect(record?.text).toContain(`/posts/guest-reply-e2e-${uid}#comment-${replyId}`);

		// Extract the unsubscribe token from the email link and confirm the UI
		// journey: open the link, the page flips the consent off.
		const tokenMatch = /comment-reply-unsubscribe\?token=([A-Za-z0-9_-]+)/.exec(record?.text ?? "");
		expect(tokenMatch).not.toBeNull();
		const token = String(tokenMatch?.[1] ?? "");
		await page.goto(`/comment-reply-unsubscribe?token=${token}`);
		await expect(page.locator("body")).toContainText("已取消订阅", { timeout: 10000 });

		// A second approved reply AFTER unsubscribe sends nothing.
		const reply2 = await request.post(`/api/comments/post/${postId}`, {
			data: {
				nickname: "Replier2",
				email: freshEmail(),
				content: "another reply",
				parent_id: guestId,
			},
		});
		expect(reply2.status()).toBe(201);
		const reply2Id = ((await reply2.json()) as { id: number }).id;
		const approve2 = await request.patch(`/api/comments/${reply2Id}/approve`, {
			headers: adminH,
			data: { approved: true },
		});
		expect(approve2.status()).toBe(200);
		// No NEW message for the guest after unsubscribing (the count stays at
		// the one from before the unsubscribe).
		const after = readFileSync(SINK_FILE, "utf8")
			.split("\n")
			.filter((l) => l.trim() && (JSON.parse(l) as { to: string }).to === guestEmail);
		expect(after.length).toBe(1);
	});
});
