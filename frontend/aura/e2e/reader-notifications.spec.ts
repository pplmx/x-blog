/**
 * Reader notification inbox journey (DEC-160, TASK-192).
 *
 * A signed-in reader who follows a category or series gets a durable inbox
 * notification when the author publishes a new post (independent of Web Push).
 * This journey: register a reader, follow a category via the API, publish a new
 * post in it (admin API), then verify the reader's /notifications page lists the
 * new-post row with an unread badge and that mark-all-read clears it. Uses the
 * live backend seeded by the justfile e2e task + the Nuxt dev server.
 */

import { type APIRequestContext, expect, test } from "@playwright/test";

const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "admin123";
const password = "e2epass123";

let emailCounter = 0;
function freshEmail(): string {
	emailCounter += 1;
	return `notif-${Date.now()}-${emailCounter}@example.com`;
}

async function adminToken(request: APIRequestContext): Promise<string> {
	const res = await request.post("/api/admin/login", {
		form: { username: ADMIN_USERNAME, password: ADMIN_PASSWORD },
	});
	expect(res.status()).toBe(200);
	return ((await res.json()) as { access_token: string }).access_token;
}

test.describe("Reader notification inbox (TASK-192)", () => {
	test.skip(() => !!process.env.CI_RESTRICTED, "full journey requires admin publish");

	test("shows a new-post notification for a followed category and marks it read", async ({
		page,
		request,
	}) => {
		const adminTok = await adminToken(request);
		const adminH = { Authorization: `Bearer ${adminTok}` };

		// Create a short-lived category.
		const uid = Date.now();
		const catRes = await request.post("/api/categories", {
			headers: adminH,
			data: { name: `Notif-Cat-${uid}` },
		});
		expect(catRes.status()).toBe(201);
		const categoryId = ((await catRes.json()) as { id: number }).id;

		// Register a reader and have them follow the category.
		const email = freshEmail();
		const reg = await request.post("/api/reader/register", {
			data: { email, password, display_name: "Notif E2E" },
		});
		expect(reg.status()).toBe(201);
		const token = ((await reg.json()) as { access_token: string }).access_token;
		const readerH = { Authorization: `Bearer ${token}` };
		const follow = await request.put(`/api/reader/me/categories/${categoryId}/follow`, {
			headers: readerH,
		});
		expect([200, 201]).toContain(follow.status());

		// Publish a new post in the category -> the reader gets an inbox row.
		const postRes = await request.post("/api/posts", {
			headers: adminH,
			data: {
				title: `Notif Post ${uid}`,
				slug: `notif-post-${uid}`,
				content: "# New part",
				published: true,
				category_id: categoryId,
			},
		});
		expect(postRes.status()).toBe(201);

		// Verify the inbox API lists the new-post notification.
		const inbox = await request.get("/api/reader/me/notifications", { headers: readerH });
		expect(inbox.status()).toBe(200);
		const inboxData = (await inbox.json()) as {
			items: Array<{ kind: string; read: boolean }>;
			unread: number;
		};
		const newPost = inboxData.items.find((i) => i.kind === "new_post");
		expect(newPost).toBeDefined();
		expect(inboxData.unread).toBeGreaterThan(0);

		// The reader's notifications page shows the row with an unread badge.
		await page.addInitScript((tk) => localStorage.setItem("reader_token", tk), token);
		await page.goto("/notifications");
		await expect(page.locator("h1").first()).toBeVisible({ timeout: 10000 });
		// 'body' alone (not main.or(body)): both selectors resolve on this page,
		// so the union hits Playwright strict-mode (2 elements). Assert on the
		// page body instead.
		await expect(page.locator("body")).toContainText("新文章发布", {
			timeout: 10000,
		});

		// Mark all read -> badge clears. The header button renders only while
		// unread > 0, so waiting for it to disappear confirms the server actually
		// processed the mark-all before the GET below (avoids a click/GET race).
		const markAll = page.getByRole("button", { name: "全部标为已读" });
		if (await markAll.isVisible().catch(() => false)) {
			await markAll.click();
			await expect(markAll).not.toBeVisible({ timeout: 10000 });
		}
		const after = await request.get("/api/reader/me/notifications", { headers: readerH });
		const afterData = (await after.json()) as { unread: number };
		expect(afterData.unread).toBe(0);
	});

	test("deletes a single notification row and the list updates (DEC-312)", async ({
		page,
		request,
	}) => {
		const adminTok = await adminToken(request);
		const adminH = { Authorization: `Bearer ${adminTok}` };

		// Register a reader and seed two durable inbox rows directly (the
		// notification dispatch is covered by the suite's other test; this
		// journey pins the DELETE + in-place list update).
		const email = freshEmail();
		const reg = await request.post("/api/reader/register", {
			data: { email, password, display_name: "Delete E2E" },
		});
		expect(reg.status()).toBe(201);
		const token = ((await reg.json()) as { access_token: string }).access_token;
		const readerH = { Authorization: `Bearer ${token}` };
		const readerId = ((await reg.json()) as { reader: { id: number } }).reader.id;

		const uid = Date.now();
		const catRes = await request.post("/api/categories", {
			headers: adminH,
			data: { name: `Del-Cat-${uid}` },
		});
		expect(catRes.status()).toBe(201);
		const categoryId = ((await catRes.json()) as { id: number }).id;
		await request.put(`/api/reader/me/categories/${categoryId}/follow`, { headers: readerH });

		// Publish two posts -> two new_post rows.
		for (const n of [1, 2]) {
			const postRes = await request.post("/api/posts", {
				headers: adminH,
				data: {
					title: `Del Post ${uid}-${n}`,
					slug: `del-post-${uid}-${n}`,
					content: "# New",
					published: true,
					category_id: categoryId,
				},
			});
			expect(postRes.status()).toBe(201);
		}

		const before = await request.get("/api/reader/me/notifications", { headers: readerH });
		const beforeData = (await before.json()) as { items: Array<{ id: number }> };
		expect(beforeData.items.length).toBe(2);
		const deleteId = beforeData.items[0].id;

		// Delete one row via the API -> total drops, the deleted row is gone.
		const del = await request.delete(`/api/reader/me/notifications/${deleteId}`, {
			headers: readerH,
		});
		expect(del.status()).toBe(204);
		const after = await request.get("/api/reader/me/notifications", { headers: readerH });
		const afterData = (await after.json()) as { items: Array<{ id: number }> };
		expect(afterData.items.length).toBe(1);
		expect(afterData.items.some((i) => i.id === deleteId)).toBe(false);

		// Deleting a non-existent id is a clean 404 (not a 500).
		const missing = await request.delete(`/api/reader/me/notifications/99999999`, {
			headers: readerH,
		});
		expect(missing.status()).toBe(404);

		// The page reflects the pruned list: one row remains, no delete of the
		// gone row errors. Delete the survivor from the UI.
		await page.addInitScript((tk) => localStorage.setItem("reader_token", tk), token);
		await page.goto("/notifications");
		await expect(page.locator("body")).toContainText("新文章发布", { timeout: 10000 });
		const delButtons = page.getByRole("button", { name: "删除这条通知" });
		await expect(delButtons).toHaveCount(1, { timeout: 10000 });
		await delButtons.click();
		// The row leaves the list: the 'new_post' badge text disappears because
		// the only remaining row was deleted (row count → 0, "no notifications").
		await expect(page.locator("body")).toContainText("暂无通知", { timeout: 10000 });
	});

	test("a @mention in an approved comment notifies the named reader (DEC-322)", async ({
		page,
		request,
	}) => {
		const adminTok = await adminToken(request);
		const adminH = { Authorization: `Bearer ${adminTok}` };

		const uid = Date.now();

		// A published post to hang the comment on.
		const postRes = await request.post("/api/posts", {
			headers: adminH,
			data: {
				title: `Mention Post ${uid}`,
				slug: `mention-post-${uid}`,
				content: "# Mention home",
				published: true,
			},
		});
		expect(postRes.status()).toBe(201);
		const postId = ((await postRes.json()) as { id: number }).id;

		// The named reader: a display name only this comment mentions.
		const targetName = `MentionBob${uid}`;
		const targetEmail = freshEmail();
		const reg = await request.post("/api/reader/register", {
			data: { email: targetEmail, password, display_name: targetName },
		});
		expect(reg.status()).toBe(201);
		const token = ((await reg.json()) as { access_token: string }).access_token;
		const readerH = { Authorization: `Bearer ${token}` };

		// A guest comment mentioning that name; approval is the moderation gate.
		const created = await request.post(`/api/comments/post/${postId}`, {
			data: {
				content: `Hi @${targetName}, please look at this`,
				nickname: "Mentioner",
				email: freshEmail(),
			},
		});
		expect(created.status()).toBe(201);
		const commentId = ((await created.json()) as { id: number }).id;
		const approved = await request.patch(`/api/comments/${commentId}/approve`, {
			data: { approved: true },
			headers: adminH,
		});
		expect(approved.status()).toBe(200);

		// The named reader's inbox gains a mention row with a comment deep link.
		const inbox = await request.get("/api/reader/me/notifications", { headers: readerH });
		expect(inbox.status()).toBe(200);
		const inboxData = (await inbox.json()) as {
			items: Array<{ kind: string; url: string | null }>;
		};
		const mention = inboxData.items.find((i) => i.kind === "mention");
		expect(mention).toBeDefined();
		expect(mention?.url).toBe(`/posts/mention-post-${uid}#comment-${commentId}`);

		// The inbox page shows the labeled mention row; following it deep-links.
		await page.addInitScript((tk) => localStorage.setItem("reader_token", tk), token);
		await page.goto("/notifications");
		await expect(page.locator("body")).toContainText("有人在评论中提到了你", {
			timeout: 10000,
		});
		const rowLink = page.locator(`a[href="/posts/mention-post-${uid}#comment-${commentId}"]`);
		await expect(rowLink).toBeVisible({ timeout: 10000 });
		await rowLink.click();
		await page.waitForURL(`**/posts/mention-post-${uid}#comment-${commentId}`, {
			timeout: 10000,
		});
		await expect(page.locator(`#comment-${commentId}`)).toBeVisible({ timeout: 10000 });
	});
});
