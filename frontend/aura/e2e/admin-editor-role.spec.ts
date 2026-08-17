import { expect, test } from "@playwright/test";

/**
 * Role-tier admin e2e (DEC-054, TASK-116): a non-superuser editor can log in and
 * moderate content (posts) but does NOT see superuser-only sections (Users in
 * the sidebar, Data Export on the dashboard).
 *
 * Requires a live backend seeded with the superuser admin/admin123. Creates a
 * one-off editor account through the admin users API as a setup step, then logs
 * in as that editor and asserts the role-aware UI.
 */

const API = "http://localhost:18888";

async function createEditorIfMissing(): Promise<string> {
	// Login as superuser to mint an editor account.
	const login = await fetch(`${API}/api/admin/login`, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({ username: "admin", password: "admin123" }),
	});
	if (!login.ok) throw new Error(`superuser login failed: ${login.status}`);
	const { access_token } = await login.json();

	// Check whether the editor already exists (idempotent across runs).
	const list = await fetch(`${API}/api/admin/users`, {
		headers: { Authorization: `Bearer ${access_token}` },
	});
	const users = (await list.json()) as { username: string }[];
	if (!users.some((u) => u.username === "e2eeditor")) {
		const created = await fetch(`${API}/api/admin/users`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${access_token}`,
			},
			body: JSON.stringify({ username: "e2eeditor", password: "editorpass123" }),
		});
		if (!created.ok) throw new Error(`create editor failed: ${created.status}`);
	}
	return access_token;
}

test.describe("Role-tier editor admin", () => {
	test.beforeAll(async () => {
		await createEditorIfMissing();
	});

	test("editor can log in and moderate posts, but no Users nav/export", async ({ page }) => {
		// Login as the editor.
		await page.goto("/admin/login");
		await page.fill('input[type="text"]', "e2eeditor");
		await page.fill('input[type="password"]', "editorpass123");
		await page.click('button[type="submit"]');
		await page.waitForURL("**/admin/posts");

		// Content moderation is available (posts list loads — API is authorized).
		await expect(page).toHaveTitle(/文章列表|文章管理|Posts/);

		// The Users nav item is hidden for editors (role-aware sidebar).
		await expect(page.locator('a:has-text("用户")')).not.toBeVisible();

		// Navigate to the dashboard: the Data Export section must be hidden.
		await page.goto("/admin");
		await expect(page.locator("text=数据导出")).not.toBeVisible();
		await expect(page.locator("text=Data Export")).not.toBeVisible();
	});

	test("editor cannot open the users page (UI hides it; backend 403s)", async ({ page }) => {
		await page.goto("/admin/login");
		await page.fill('input[type="text"]', "e2eeditor");
		await page.fill('input[type="password"]', "editorpass123");
		await page.click('button[type="submit"]');
		await page.waitForURL("**/admin/posts");

		// Direct navigation to a superuser-only route must not render the
		// users management (the API returns 403, surfaced as an error state).
		await page.goto("/admin/users");
		await expect(page.locator('h2:has-text("新建管理员")')).not.toBeVisible();
	});
});
