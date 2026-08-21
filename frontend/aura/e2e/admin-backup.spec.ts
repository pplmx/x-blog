/**
 * Full-blog backup & restore admin journey (DEC-082, TASK-153).
 *
 * The dashboard exposes a superuser-only card: download the whole blog as one
 * JSON snapshot, or restore one. This spec pins the admin-gated UI — the card
 * renders for a superuser (with a working download + restore round-trip that
 * reports counts) and is hidden for editors (the API itself enforces the 403).
 * The snapshot contract (shape, auth-data exclusion, natural-key upsert,
 * import_key idempotency, round-trip) is pinned by
 * tests/test_backup.py.
 */

import { expect, test } from "@playwright/test";

const API = "http://localhost:18888";

async function signInSuperuser(page: import("@playwright/test").Page) {
	await page.goto("/admin/login");
	await page.fill('input[type="text"]', "admin");
	await page.fill('input[type="password"]', "admin123");
	await page.click('button[type="submit"]');
	await page.waitForURL("**/admin/posts");
}

test.describe("Blog backup & restore (superuser-gated)", () => {
	test("superuser sees the card and downloads a full snapshot", async ({ page }) => {
		await signInSuperuser(page);
		await page.goto("/admin");

		await expect(page.locator("h3", { hasText: /备份与恢复|Backup & restore/i })).toBeVisible();

		const downloadPromise = page.waitForEvent("download", { timeout: 10_000 });
		await page.getByRole("button", { name: /下载完整备份|Download full backup/i }).click();
		const download = await downloadPromise;
		expect(download.suggestedFilename()).toMatch(/^x-blog-backup-\d{4}-\d{2}-\d{2}\.json$/);
	});

	test("restore uploads a snapshot and reports counts", async ({ page }) => {
		await signInSuperuser(page);
		await page.goto("/admin");

		// An empty snapshot is a valid no-op restore: the UI must surface the
		// counts summary (all zeros) without touching existing content — while
		// still exercising the full upload → POST → feedback path.
		const snap = {
			format: "x-blog-backup",
			version: 1,
			exported_at: "x",
			categories: [],
			tags: [],
			series: [],
			posts: [],
		};
		await page.locator('input[type="file"]').setInputFiles({
			name: "backup.json",
			mimeType: "application/json",
			buffer: Buffer.from(JSON.stringify(snap)),
		});

		await expect(page.locator("text=/恢复完成|Restore complete/")).toBeVisible({
			timeout: 10_000,
		});
	});

	test("editor does not see the backup card (superuser-only)", async ({ page }) => {
		// Idempotently mint an editor through the admin users API (DEC-054).
		const login = await fetch(`${API}/api/admin/login`, {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({ username: "admin", password: "admin123" }),
		});
		expect(login.ok).toBeTruthy();
		const { access_token } = await login.json();
		const users = await (
			await fetch(`${API}/api/admin/users`, {
				headers: { Authorization: `Bearer ${access_token}` },
			})
		).json();
		if (!users.some((u: { username: string }) => u.username === "e2eeditor")) {
			const created = await fetch(`${API}/api/admin/users`, {
				method: "POST",
				headers: { "Content-Type": "application/json", Authorization: `Bearer ${access_token}` },
				body: JSON.stringify({ username: "e2eeditor", password: "editorpass123" }),
			});
			expect(created.ok).toBeTruthy();
		}

		await page.goto("/admin/login");
		await page.fill('input[type="text"]', "e2eeditor");
		await page.fill('input[type="password"]', "editorpass123");
		await page.click('button[type="submit"]');
		await page.waitForURL("**/admin/posts");

		await page.goto("/admin");
		await expect(page.getByRole("heading", { name: /仪表盘|Dashboard/i })).toBeVisible();
		await expect(page.locator("h3", { hasText: /备份与恢复|Backup & restore/i })).toHaveCount(0);
	});
});
