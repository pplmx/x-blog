/**
 * Markdown image lightbox journey (DEC-302, TASK-379).
 *
 * A published post carries markdown images; the reader clicks one and gets a
 * fullscreen viewer (full-res image + "n / total" counter), browses with the
 * arrow keys, and closes via Escape, the backdrop or the close button — with
 * keyboard focus returning to the image that opened it. A `javascript:` image
 * src must never reach the viewer.
 *
 * The post is seeded via the admin API (reusing the public post-markdown
 * pipeline: marked → useMarkdown image segments), asserted in a real browser,
 * then deleted.
 */

import { type APIRequestContext, expect, type Page, test } from "@playwright/test";

const stamp = Date.now();
const SLUG_FIRST = `lightbox-first-${stamp}`;
const SLUG_UNSAFE = `lightbox-unsafe-${stamp}`;
const createdIds: number[] = [];

/** Markdown for the seeded post: two images → a two-item viewer with nav. */
function twoImageContent(): string {
	return [
		"# Lightbox journey",
		"",
		"First image:",
		"",
		"![Diagram A](/logo.png)",
		"",
		"Second image:",
		"",
		"![Diagram B](/favicon.ico)",
		"",
	].join("\n");
}

async function adminToken(page: Page): Promise<string> {
	await page.goto("/admin/login");
	await page.fill('input[type="text"]', "admin");
	await page.fill('input[type="password"]', "admin123");
	await page.click('button[type="submit"]');
	await page.waitForURL("**/admin/posts");
	const token = (await page.evaluate(() => localStorage.getItem("admin_token"))) ?? "";
	expect(token.length).toBeGreaterThan(0);
	return token;
}

async function seedPost(
	request: APIRequestContext,
	token: string,
	slug: string,
	content: string,
): Promise<number> {
	const created = await request.post("/api/admin/posts", {
		data: {
			title: "Lightbox Journey",
			slug,
			content,
			excerpt: "lightbox journey",
			published: true,
		},
		headers: { Authorization: `Bearer ${token}` },
	});
	expect(created.status()).toBe(201);
	const id = (await created.json()).id as number;
	createdIds.push(id);
	return id;
}

test.afterAll(async ({ request }) => {
	const admin = await request.post("/api/admin/login", {
		form: { username: "admin", password: "admin123" },
	});
	const token = ((await admin.json()) as { access_token: string }).access_token;
	for (const id of createdIds) {
		await request.delete(`/api/admin/posts/${id}`, {
			headers: { Authorization: `Bearer ${token}` },
		});
	}
});

test.describe("Markdown image lightbox (DEC-302/TASK-379)", () => {
	test("click opens fullscreen; arrows browse; Escape/backdrop/close exit and focus returns", async ({
		page,
		request,
	}) => {
		// Seed a published post with two images.
		const token = await adminToken(page);
		await seedPost(request, token, SLUG_FIRST, twoImageContent());

		await page.goto(`/posts/${SLUG_FIRST}`);
		const trigger = page.getByTestId("markdown-image-trigger").first();
		await expect(trigger).toBeVisible({ timeout: 10000 });
		await trigger.click();

		// Fullscreen viewer opens on image 1/2 with the image visible.
		const lightbox = page.getByTestId("lightbox");
		await expect(lightbox).toBeVisible();
		await expect(lightbox.getByTestId("lightbox-image")).toBeVisible();
		await expect(lightbox).toContainText("1 / 2");

		// Arrow-right browses to the second image.
		await lightbox.press("ArrowRight");
		await expect(lightbox).toContainText("2 / 2");

		// Arrow-left wraps back to the first.
		await lightbox.press("ArrowLeft");
		await expect(lightbox).toContainText("1 / 2");

		// Escape closes.
		await lightbox.press("Escape");
		await expect(lightbox).not.toBeVisible();
		// Focus returns to the image that opened the viewer.
		const focused = await page.evaluate(() => document.activeElement?.getAttribute("data-testid"));
		expect(focused).toBe("markdown-image-trigger");

		// Backdrop click closes.
		await trigger.click();
		await expect(lightbox).toBeVisible();
		await page.getByTestId("lightbox-backdrop").click({ position: { x: 8, y: 8 } });
		await expect(lightbox).not.toBeVisible();

		// Close button closes.
		await trigger.click();
		await expect(lightbox).toBeVisible();
		await page.getByTestId("lightbox-close").click();
		await expect(lightbox).not.toBeVisible();
	});

	test("a javascript: image src never opens the viewer", async ({ page, request }) => {
		const token = await adminToken(page);
		await seedPost(
			request,
			token,
			SLUG_UNSAFE,
			"Unsafe: ![x](javascript:alert(1))\n\nSafe: ![ok](/logo.png)",
		);

		await page.goto(`/posts/${SLUG_UNSAFE}`);
		const triggers = page.getByTestId("markdown-image-trigger");
		await expect(triggers.first()).toBeVisible({ timeout: 10000 });

		// The unsafe image renders its inert trigger (inline broken-image
		// rendering, unchanged) but a click on it must NOT open the viewer —
		// the javascript: src is filtered out of the lightbox image set.
		const lightbox = page.getByTestId("lightbox");
		await triggers.first().click();
		await expect(lightbox).not.toBeVisible();

		// The safe image opens the viewer with only itself in the set.
		await triggers.nth(1).click();
		await expect(lightbox).toBeVisible();
		await expect(lightbox).toContainText("1 / 1");
		const src = await lightbox.getByTestId("lightbox-image").getAttribute("src");
		expect(src).toBe("/logo.png");
	});
});
