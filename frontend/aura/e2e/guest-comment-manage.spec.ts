/**
 * Guest comment management journey (round 385, DEC-435/TASK-444).
 *
 * An anonymous commenter who consents to the reply email gets a per-comment
 * secret token (DEC-332) that flows through the SMTP sink as an approval-time
 * "your comment is live — manage it" email. That email deep-links to the flat
 * /comment-manage page, where the guest can edit the comment's text (it
 * re-enters moderation, exactly like a signed-in reader's edit) or delete the
 * comment entirely — no account needed. This spec drives that full loop: guest
 * comments with consent → admin approves → sink carries the manage link →
 * browser opens it → edit saves → delete removes the comment from the thread.
 * Uses the live backend seeded by `just e2e` + the Nuxt dev server. Skipped
 * when no SMTP sink is up.
 */

import { readFileSync } from "node:fs";
import { type APIRequestContext, expect, test } from "@playwright/test";

const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "admin123";
const SINK_FILE = "/tmp/x-blog-smtp-sink.jsonl";

let counter = 0;
function freshEmail(): string {
	counter += 1;
	return `guest-manage-${Date.now()}-${counter}@example.com`;
}

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

test.describe("Guest comment management (DEC-435/TASK-444)", () => {
	test.skip(() => !!process.env.CI_RESTRICTED, "full journey requires admin publish");

	test("guest edits then deletes their own comment via the emailed manage link", async ({
		page,
		request,
	}) => {
		test.skip(!(await smtpIsUp(request)), "requires the e2e SMTP sink");

		const adminTok = await adminToken(request);
		const adminH = { Authorization: `Bearer ${adminTok}` };
		const uid = Date.now();
		const guestEmail = freshEmail();
		const postSlug = `guest-manage-e2e-${uid}`;

		const post = await request.post("/api/posts", {
			headers: adminH,
			data: {
				title: `Guest manage ${uid}`,
				slug: postSlug,
				content: "# Hello",
				published: true,
			},
		});
		expect(post.status()).toBe(201);
		const postId = ((await post.json()) as { id: number }).id;

		// A guest comments with consent (the only way a guest gets a token).
		const comment = await request.post(`/api/comments/post/${postId}`, {
			data: {
				nickname: "Manage Me",
				email: guestEmail,
				content: "original text",
				reply_notify_email: true,
			},
		});
		expect(comment.status()).toBe(201);
		const commentId = ((await comment.json()) as { id: number }).id;

		// The author approves → the approval-time manage email carries the link.
		const approve = await request.patch(`/api/comments/${commentId}/approve`, {
			headers: adminH,
			data: { approved: true },
		});
		expect(approve.status()).toBe(200);

		const manageRecord = messageFromSink(guestEmail);
		expect(manageRecord).toBeDefined();
		expect(manageRecord?.subject).toBe("你的评论已发布 — 可管理");
		const manageMatch = /comment-manage\?token=([A-Za-z0-9_-]+)/.exec(manageRecord?.text ?? "");
		expect(manageMatch).not.toBeNull();
		const token = String(manageMatch?.[1] ?? "");

		// Opening the emailed link loads the comment for the guest.
		await page.goto(`/comment-manage?token=${token}`);
		await expect(page.locator("h1")).toContainText("你的评论", { timeout: 10000 });
		await expect(page.getByLabel("评论内容")).toHaveValue("original text");
		// Approved at this point, so the public badge shows.
		await expect(page.locator("body")).toContainText("已发布");

		// Edit the text: the manage page saves through the token.
		await page.getByLabel("评论内容").fill("fixed typo");
		await page.getByRole("button", { name: "保存修改" }).click();
		await expect(page.locator("body")).toContainText("已保存", { timeout: 10000 });
		// The replaced text re-enters moderation (pending badge now).
		await expect(page.locator("body")).toContainText("待审核", { timeout: 10000 });
		expect((await request.get(`/api/comments/post/${postId}`)).status()).toBe(200);
		const publicList = await (await request.get(`/api/comments/post/${postId}`)).json();
		// After the edit the comment is pending → not in the public list.
		expect((publicList as { items: unknown[] }).items).toEqual([]);

		// Delete it via the manage page (confirmed by the browser dialog).
		page.once("dialog", (dialog) => void dialog.accept());
		await page.getByRole("button", { name: "删除评论" }).click();
		await expect(page.locator("body")).toContainText("评论已删除", { timeout: 10000 });

		// Gone from the backend entirely — the token now 404s on a reload.
		const after = await (await request.get(`/api/comments/post/${postId}`)).json();
		expect((after as { items: unknown[] }).items).toEqual([]);
		await page.goto(`/comment-manage?token=${token}`);
		await expect(page.locator("body")).toContainText("这个链接无效，或已经被使用过。", {
			timeout: 10000,
		});
	});
});
