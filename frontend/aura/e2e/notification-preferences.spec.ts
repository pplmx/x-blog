/**
 * Reader notification-preferences journey (DEC-171, TASK-202).
 *
 * A signed-in reader can silence a whole notification kind (new posts, replies,
 * thread comments) — the toggle is persisted server-side and gates both the
 * durable inbox row and the browser push at every dispatch point. This journey
 * registers a reader, opens /notifications, verifies the three all-on toggles
 * render, flips the reply toggle off, confirms the PATCH persists (GET shows
 * reply=false), and verifies the off state survives a page reload. No admin
 * actions needed, so it runs in restricted CI too. Uses the live backend seeded
 * by the justfile e2e task + the Nuxt dev server.
 */

import { expect, test } from "@playwright/test";

const password = "e2epass123";

test.describe("Reader notification preferences (TASK-202)", () => {
	test("toggles a notification kind off and persists across reload", async ({ page, request }) => {
		// Register a fresh reader.
		const email = `prefs-${Date.now()}@example.com`;
		const reg = await request.post("/api/reader/register", {
			data: { email, password, display_name: "Prefs E2E" },
		});
		expect(reg.status()).toBe(201);
		const token = ((await reg.json()) as { access_token: string }).access_token;
		const readerH = { Authorization: `Bearer ${token}` };

		// Before touching the UI: the preferences API reports all kinds on.
		const initial = await request.get("/api/reader/me/notification-preferences", {
			headers: readerH,
		});
		expect(initial.status()).toBe(200);
		const initialData = (await initial.json()) as {
			new_post: boolean;
			reply: boolean;
			thread_comment: boolean;
			email_new_post: boolean;
			email_reply: boolean;
			email_thread_comment: boolean;
		};
		expect(initialData).toEqual({
			new_post: true,
			reply: true,
			thread_comment: true,
			email_new_post: false,
			email_reply: false,
			email_thread_comment: false,
		});

		// Open /notifications signed-in.
		await page.addInitScript((tk) => localStorage.setItem("reader_token", tk), token);
		await page.goto("/notifications");
		await expect(page.locator("h1").first()).toBeVisible({ timeout: 10000 });

		// The preferences card shows three toggles, all on.
		const replySwitch = page.getByRole("switch", { name: "收到回复" });
		const newPostSwitch = page.getByRole("switch", { name: "新文章发布" });
		const threadSwitch = page.getByRole("switch", { name: "讨论有新评论" });
		await expect(replySwitch).toBeVisible({ timeout: 10000 });
		await expect(replySwitch).toHaveAttribute("aria-checked", "true");
		await expect(newPostSwitch).toHaveAttribute("aria-checked", "true");
		await expect(threadSwitch).toHaveAttribute("aria-checked", "true");

		// Flip the reply kind off -> PATCH persists it server-side.
		await replySwitch.click();
		await expect(replySwitch).toHaveAttribute("aria-checked", "false");
		const after = await request.get("/api/reader/me/notification-preferences", {
			headers: readerH,
		});
		const afterData = (await after.json()) as {
			new_post: boolean;
			reply: boolean;
			thread_comment: boolean;
			email_new_post: boolean;
			email_reply: boolean;
			email_thread_comment: boolean;
		};
		expect(afterData.reply).toBe(false);
		expect(afterData.new_post).toBe(true);
		expect(afterData.thread_comment).toBe(true);
		expect(afterData.email_new_post).toBe(false);

		// Reload: the off state comes back from the server (not UI-only).
		await page.reload();
		await expect(replySwitch).toBeVisible({ timeout: 10000 });
		await expect(replySwitch).toHaveAttribute("aria-checked", "false");
	});

	test("email notification kinds are off by default and toggle on persists (DEC-197, TASK-218)", async ({
		page,
		request,
	}) => {
		const email = `prefs-email-${Date.now()}@example.com`;
		const reg = await request.post("/api/reader/register", {
			data: { email, password, display_name: "Prefs Email E2E" },
		});
		expect(reg.status()).toBe(201);
		const token = ((await reg.json()) as { access_token: string }).access_token;
		const readerH = { Authorization: `Bearer ${token}` };

		await page.addInitScript((tk) => localStorage.setItem("reader_token", tk), token);
		await page.goto("/notifications");
		await expect(page.locator("h1").first()).toBeVisible({ timeout: 10000 });

		// The email channel is strictly opt-in: each email kind renders its own
		// toggle, all off by default, alongside the push/inbox kinds (now six
		// switches total).
		const emailNewPost = page.getByRole("switch", { name: "邮件：新文章" });
		const emailReply = page.getByRole("switch", { name: "邮件：回复" });
		await expect(page.getByRole("switch")).toHaveCount(6);
		await expect(emailNewPost).toHaveAttribute("aria-checked", "false");
		await expect(emailReply).toHaveAttribute("aria-checked", "false");

		// Flip one email kind on -> the PATCH persists it server-side.
		await emailNewPost.click();
		await expect(emailNewPost).toHaveAttribute("aria-checked", "true");
		const after = await request.get("/api/reader/me/notification-preferences", {
			headers: readerH,
		});
		const afterData = (await after.json()) as {
			email_new_post: boolean;
			email_reply: boolean;
		};
		expect(afterData.email_new_post).toBe(true);
		expect(afterData.email_reply).toBe(false);

		// Reload: the email-on state comes back from the server.
		await page.reload();
		await expect(emailNewPost).toBeVisible({ timeout: 10000 });
		await expect(emailNewPost).toHaveAttribute("aria-checked", "true");
	});
});
