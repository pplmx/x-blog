/**
 * Admin post editor draft auto-save (RIL TASK-190, DEC-156).
 *
 * An author's edits are persisted to a draft automatically after a debounce,
 * with a visible "saved" state and without an explicit save:
 *   1. editing an existing draft shows the save indicator and survives reload;
 *   2. typing a brand-new post auto-creates a draft (no manual save) and the
 *      address bar points at the created draft.
 */

import { expect, test } from "@playwright/test";

const stamp = Date.now();

async function login(page: import("@playwright/test").Page) {
	await page.goto("/admin/login");
	await page.fill('input[type="text"]', "admin");
	await page.fill('input[type="password"]', "admin123");
	await page.click('button[type="submit"]');
	await page.waitForURL("**/admin/posts");
	const token = (await page.evaluate(() => localStorage.getItem("admin_token"))) ?? "";
	return { token, headers: { Authorization: `Bearer ${token}` } };
}

test.describe("Admin post draft auto-save (TASK-190)", () => {
	test("editing an existing draft auto-persists and shows the saved state", async ({
		page,
		request,
	}) => {
		const { headers } = await login(page);

		// Seed a draft post via the API so we operate on a known id.
		const title = `Autosave Existing ${stamp}`;
		const slug = `autosave-existing-${stamp}`;
		const created = await request.post("/api/admin/posts", {
			data: { title, slug, content: "# Seed body", excerpt: "seed", published: false },
			headers,
		});
		expect(created.ok()).toBe(true);
		const postId = ((await created.json()) as { id: number }).id;

		await page.goto(`/admin/posts/${postId}`);
		const titleInput = page.locator('input[placeholder="输入文章标题"]');
		await expect(titleInput).toHaveValue(title, { timeout: 10000 });

		const edited = `${title} edited ${stamp}`;
		await titleInput.fill(edited);
		await titleInput.press("Tab"); // blur settles the input stream

		// Debounce + network -> visible saved state.
		const status = page.locator('[data-testid="autosave-status"]');
		await expect(status).toContainText("已自动保存", { timeout: 10000 });

		// A reload reads the persisted draft back.
		await page.reload();
		await expect(titleInput).toHaveValue(edited, { timeout: 10000 });
	});

	test("typing a brand-new post auto-creates a draft without an explicit save", async ({
		page,
	}) => {
		await login(page);

		const createBtn = page.locator(
			'a:has-text("新建文章"), a:has-text("新建"), button:has-text("新建")',
		);
		await expect(createBtn).toBeVisible();
		await createBtn.click();
		await page.waitForURL("**/admin/posts/new");

		const title = `Auto-Saved Draft ${stamp}`;
		const titleInput = page.locator('input[placeholder="输入文章标题"]');
		await titleInput.fill(title);
		const contentTextarea = page.locator('textarea[placeholder*="Markdown"]');
		await contentTextarea.fill("# Auto saved body");
		await contentTextarea.press("Tab");

		// The first auto-save creates the draft and points the URL at it.
		await expect(page).toHaveURL(/\/admin\/posts\/\d+/, { timeout: 10000 });

		// Reload confirms the draft persisted (no manual save happened).
		await page.reload();
		await expect(titleInput).toHaveValue(title, { timeout: 10000 });
		await expect(contentTextarea).toHaveValue("# Auto saved body");
	});
});
