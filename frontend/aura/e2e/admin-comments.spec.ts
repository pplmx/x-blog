import { expect, test } from "@playwright/test";

test.describe("Admin comment management", () => {
	test.beforeEach(async ({ page }) => {
		// Log in first
		await page.goto("/admin/login");
		await page.fill('input[type="text"]', "admin");
		await page.fill('input[type="password"]', "admin123");
		await page.click('button[type="submit"]');
		// Login redirects to /admin/posts; navigate to the page under test
		await page.waitForURL("**/admin/posts");
		await page.goto("/admin/comments");
	});

	test("admin can view the comments list", async ({ page }) => {
		await expect(page).toHaveTitle(/评论|Comments/);

		// Comments render as cards in a .space-y-3 list
		const list = page.locator(".space-y-3");
		await expect(list).toBeVisible();

		// Cards show moderation status and action buttons
		const listText = (await list.textContent()) || "";
		expect(listText).toMatch(/待审核|已审核|通过|删除/);
	});

	test("admin can approve a pending comment", async ({ page }) => {
		// Find a pending comment (status = "pending" or "待审核")
		const pendingRow = page.locator(".space-y-3 > div", { hasText: "待审核" }).first();

		if (await pendingRow.isVisible()) {
			// Click approve button
			const approveBtn = pendingRow.locator('button:has-text("通过")');
			if (await approveBtn.isVisible()) {
				await approveBtn.click();

				// Should update status
				await expect(pendingRow).toContainText(/approved|已批准|published/i);
			}
		}
	});

	test("admin can delete a comment with confirmation", async ({ page }) => {
		const commentRows = page.locator(".space-y-3 > div");
		const count = await commentRows.count();

		if (count > 0) {
			const firstRow = commentRows.first();
			const deleteBtn = firstRow.locator('button:has-text("删除")');

			if (await deleteBtn.isVisible()) {
				// The page uses window.confirm for delete confirmation
				page.on("dialog", (dialog) => dialog.accept());
				await deleteBtn.click();

				// Comment should be removed from the list
				await expect(commentRows).toHaveCount(count - 1);
			}
		}
	});

	test("admin can filter comments by status", async ({ page, request }) => {
		// Self-contained: plant a pending comment via the public API so the
		// filter has a deterministic pending row regardless of earlier tests'
		// mutations of the shared e2e DB.
		const posts = await request.get("/api/posts?limit=1");
		const pid = ((await posts.json()) as { items: Array<{ id: number }> }).items[0].id;
		const created = await request.post(`/api/comments/post/${pid}`, {
			data: {
				nickname: "FilterProbe",
				email: "probe@example.com",
				content: "pending filter probe comment",
			},
		});
		expect(created.status()).toBe(201);

		// Status filters are the "全部/待审核/已审核" (zh) / "All/Pending/Approved"
		// (en) buttons in the filter bar. getByRole("button") keeps the label
		// match from grabbing the status badge spans rendered on comment cards.
		const pendingFilter = page.getByRole("button", { name: /待审核|pending/i });

		// Deterministic contract check: the applied filter's backend response
		// (identified by its is_approved=false query) contains only unapproved
		// comments, including our planted probe. Asserting the response (not a
		// snapshot of the rendered DOM) is what caught the historical
		// mixed-list bug at its source.
		const filterResponse = page.waitForResponse((r) => r.url().includes("is_approved=false"), {
			timeout: 15000,
		});
		await pendingFilter.click();
		const resp = await filterResponse;
		const body = (await resp.json()) as {
			items: Array<{ is_approved: boolean; content: string }>;
		};
		expect(body.items.length).toBeGreaterThan(0);
		expect(body.items.every((c) => c.is_approved === false)).toBe(true);
		expect(body.items.some((c) => c.content.includes("pending filter probe"))).toBe(true);
	});

	test("admin replies to a comment as the author; the public thread badges it (DEC-192)", async ({
		page,
		request,
	}) => {
		// beforeEach already signed into /admin/comments; derive the token for
		// the API seeding/approve calls (approval is what makes the reply action
		// available — the same rule as the create path).
		const token = (await page.evaluate(() => localStorage.getItem("admin_token"))) ?? "";
		const headers = { Authorization: `Bearer ${token}` };
		const marker = `Follow-up planned? ${Date.now()}`;
		const post = (
			(await (await request.get("/api/posts?limit=1")).json()) as {
				items: Array<{ id: number; slug: string }>;
			}
		).items[0];

		// Plant a comment via the public API and approve it via the admin API.
		const created = await request.post(`/api/comments/post/${post.id}`, {
			data: { nickname: "CuriousReader", email: "cr@example.com", content: marker },
		});
		expect(created.status()).toBe(201);
		const cid = ((await created.json()) as { id: number }).id;
		const approved = await request.patch(`/api/comments/${cid}/approve`, {
			headers,
			data: { approved: true },
		});
		expect(approved.status()).toBe(200);

		// Reload the queue so the newly approved comment is on screen.
		await page.reload();
		const row = page.locator(".space-y-3 > div", { hasText: marker }).first();
		await expect(row).toBeVisible();
		await row.getByRole("button", { name: "回复" }).click();
		// Unique reply text: the shared e2e DB accumulates rows across runs, so
		// a fixed string would strict-mode-match multiple replies.
		const replyText = `正在写续篇，感谢关注！${Date.now()}`;
		await row.locator("textarea").fill(replyText);
		await row.getByRole("button", { name: "发送回复" }).click();

		// The created reply shows up in the queue with the author badge.
		await expect(page.getByText(replyText).first()).toBeVisible({ timeout: 10000 });
		await expect(page.getByText("作者回复").first()).toBeVisible({ timeout: 10000 });

		// The public thread renders it with the reader-facing author badge.
		await page.goto(`/posts/${post.slug}`);
		await expect(page.getByText(replyText).first()).toBeVisible({ timeout: 10000 });
		await expect(page.getByText("作者", { exact: true }).first()).toBeVisible();
	});
});
