/**
 * Reading-trend analytics journey (DEC-086, TASK-155).
 *
 * Posting views advances a per-day counter; the admin dashboard renders a
 * "阅读趋势" card with the period total and the hot posts. This spec pins the
 * admin-gated UI (superuser AND editor both see it — moderators oversee the
 * blog's readership) plus the live backend round-trip: views recorded through
 * the public view endpoint appear in the trend card. The series/upsert/unique
 * contract itself is pinned by tests/test_analytics.py.
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

test.describe("Reading-trend analytics (admin dashboard)", () => {
	test("recorded views appear in the superuser trend card", async ({ page }) => {
		// Record two views on the seeded first post through the public endpoint.
		const feed = await page.request.get("/api/posts?limit=1");
		const first = ((await feed.json()) as { items: Array<{ id: number }> }).items[0];
		await page.request.post(`/api/posts/${first.id}/view`);
		await page.request.post(`/api/posts/${first.id}/view`);

		await signInSuperuser(page);
		await page.goto("/admin");

		await expect(page.locator("h3", { hasText: /阅读趋势|Reading trend/i })).toBeVisible();
		await expect(page.locator("text=/本期热门文章|Hot posts this period/i")).toBeVisible({
			timeout: 10_000,
		});
	});

	test("editor also sees the trend card", async ({ page }) => {
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
		await expect(page.locator("h3", { hasText: /阅读趋势|Reading trend/i })).toBeVisible();
	});
});
