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
});
