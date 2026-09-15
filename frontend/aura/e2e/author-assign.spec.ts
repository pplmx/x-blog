/**
 * Admin post-editor author assignment (DEC-359, TASK-406).
 *
 * The editor's author picker lets any admin attribute a post to another
 * public writer (or keep the default "me"): a post created through the editor
 * and assigned to a second pen-named admin carries THAT writer's byline on
 * the public post page, and opening the post for editing pre-selects its
 * stored author.
 *
 * Uses the live backend seeded by the justfile `e2e` task + the Nuxt dev
 * server. Unique per run (timestamps) so retries never collide; the created
 * post and the second admin are cleaned up at the end.
 */

import { type APIRequestContext, expect, test } from "@playwright/test";

const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "admin123";

async function adminToken(request: APIRequestContext): Promise<string> {
	const res = await request.post("/api/admin/login", {
		form: { username: ADMIN_USERNAME, password: ADMIN_PASSWORD },
	});
	expect(res.status()).toBe(200);
	return ((await res.json()) as { access_token: string }).access_token;
}

type AdminUser = { id: number; username: string; display_name?: string | null };

async function getMe(request: APIRequestContext, token: string): Promise<AdminUser> {
	const res = await request.get("/api/admin/me", {
		headers: { Authorization: `Bearer ${token}` },
	});
	expect(res.status()).toBe(200);
	return (await res.json()) as AdminUser;
}

test.describe("Admin editor author assignment (DEC-359)", () => {
	test.skip(
		() => !!process.env.CI_RESTRICTED,
		"full journey requires an admin publish on the live backend",
	);

	test("create via editor with another author -> that byline public + edit pre-selects", async ({
		page,
		request,
	}) => {
		const uid = Date.now();
		const mainPen = `Main Editor ${uid}`;
		const otherUsername = `other${uid}`;
		const otherPen = `Other Writer ${uid}`;
		const title = `Assigned post ${uid}`;

		const token = await adminToken(request);
		const adminH = { Authorization: `Bearer ${token}` };
		const { id: mainId } = await getMe(request, token);

		// Give the writing admin a pen name and stand up a second pen-named
		// admin — the assignable target.
		await request.patch(`/api/admin/users/${mainId}`, {
			headers: { "Content-Type": "application/json", ...adminH },
			data: { display_name: mainPen },
		});
		const created = await request.post("/api/admin/users", {
			headers: { "Content-Type": "application/json", ...adminH },
			data: { username: otherUsername, password: "editorpass123", display_name: otherPen },
		});
		expect(created.status()).toBe(200);
		const otherId = ((await created.json()) as AdminUser).id;

		let postId = 0;
		try {
			// Login and create the post through the editor UI (generous timeout:
			// the sandbox's first post-build admin nav has a known slow-load
			// habit, and the login redirect is page-request-bound).
			await page.goto("/admin/login", { timeout: 20000 });
			await page.fill('input[type="text"]', ADMIN_USERNAME);
			await page.fill('input[type="password"]', ADMIN_PASSWORD);
			await page.click('button[type="submit"]');
			await page.waitForURL("**/admin/posts", { timeout: 20000 });

			await page.goto("/admin/posts/new");
			await page.fill('input[placeholder="输入文章标题"]', title);
			await page.fill('textarea[placeholder*="Markdown"]', "# Assigned content");

			// The author picker defaults to "me"; assign to the other writer.
			// Options inside a closed <select> are never "visible", so assert
			// the target option's PRESENCE by count, not visibility.
			const authorSelect = page.locator("#post-author");
			await expect(authorSelect).toBeVisible({ timeout: 10000 });
			await expect(authorSelect.locator(`option[value="${otherId}"]`)).toHaveCount(1);
			await authorSelect.selectOption(String(otherId));

			// Publish (the manual save button; auto-save drafts in between).
			await page.check("#published");
			await page.getByRole("button", { name: "保存文章" }).click();

			// The create redirects to the saved post's url.
			await page.waitForURL(/\/admin\/posts\/\d+/);
			const match = /\/(\d+)$/.exec(new URL(page.url()).pathname);
			postId = Number.parseInt(match?.[1] ?? "0", 10);
			expect(postId).toBeGreaterThan(0);

			// Editing the saved post pre-selects its stored author.
			await expect(authorSelect).toHaveValue(String(otherId), { timeout: 10000 });

			// Public post page carries the OTHER writer's byline (`.first()` —
			// the page has the post-title h1 plus the content's own `# ...`
			// headings; strict mode would reject the multi-match).
			const slug = title
				.toLowerCase()
				.replace(/[^a-z0-9]+/g, "-")
				.replace(/^-+|-+$/g, "");
			await page.goto(`/posts/${slug}`);
			await expect(page.locator("h1").first()).toContainText(title, { timeout: 10000 });
			await expect(page.locator(`header a[href="/authors/${otherId}"]`)).toContainText(otherPen);

			// The other writer's archive lists the assigned post, titled by pen name.
			await page.goto(`/authors/${otherId}`);
			await expect(page.locator("h1")).toContainText(otherPen);
			await expect(page.locator(`article:has-text("${title}")`)).toBeVisible();
		} finally {
			if (postId) {
				await request.delete(`/api/admin/posts/${postId}`, { headers: adminH });
			}
			await request.delete(`/api/admin/users/${otherId}`, { headers: adminH });
			await request.patch(`/api/admin/users/${mainId}`, {
				headers: { "Content-Type": "application/json", ...adminH },
				data: { display_name: null },
			});
		}
	});
});
