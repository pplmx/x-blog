/**
 * Comment live-preview journey (DEC-306, TASK-381).
 *
 * The comment form advertises sanitized-Markdown rendering (DEC-088) but the
 * draft only renders after submit + moderation (DEC-066), so a malformed
 * markup draft would burn an approval cycle with zero feedback. This spec
 * pins the fix: a commenter toggles Write/Preview and sees their draft
 * rendered live by the same commentMarkdownToHtml pipeline the comment list
 * ships — code fences get a real <pre><code>, emphasis renders — and the
 * preview stays XSS-inert (no live script/event-handler nodes).
 *
 * Runs as an anonymous visitor (the preview is form-local, no auth needed).
 */

import { expect, test } from "@playwright/test";

const DRAFT = "Check this **bold** and a fence:\n\n```ts\nconst y = 2;\n```";

test.describe("Comment live preview (DEC-306)", () => {
	test("Write/Preview toggle renders the draft as sanitized markdown", async ({ page }) => {
		// Open the first post and scroll the bottom-of-page comment form into
		// view (the form is below the article + previous comments).
		await page.goto("/");
		const postLink = page.locator("main a[href*='/posts/']").first();
		await postLink.waitFor({ state: "visible" });
		const postHref = (await postLink.getAttribute("href")) as string;
		await page.goto(postHref);

		const contentInput = page.locator("[id^='comment-content']");
		await contentInput.waitFor({ state: "visible", timeout: 10000 });

		// Write tab is default: markdown hint visible, no preview pane yet.
		const previewTab = page.locator('[data-tab="preview"]');
		const writeTab = page.locator('[data-tab="write"]');
		await expect(previewTab).toBeVisible();
		await expect(page.locator(".comment-preview")).toHaveCount(0);

		// Type a markdown draft, then switch to Preview.
		await contentInput.fill(DRAFT);
		await previewTab.click();

		// The pane renders the same pipeline the list ships: a fenced code
		// block and emphasis become real elements.
		const previewBody = page.locator(".comment-preview");
		await expect(previewBody).toBeVisible({ timeout: 10000 });
		await expect(previewBody.locator("strong")).toHaveText("bold");
		await expect(previewBody.locator("pre code.language-ts")).toContainText("const y = 2;");

		// Switching back to Write restores the editor with the draft intact.
		await writeTab.click();
		await expect(contentInput).toBeVisible();
		await expect(contentInput).toHaveValue(DRAFT);
	});

	test("preview never lets a script/event-handler payload reach the DOM", async ({ page }) => {
		const payload = 'hello <script id="pve">window.__pv=1</script> <img src=x onerror="alert(1)">';

		await page.goto("/");
		const postLink = page.locator("main a[href*='/posts/']").first();
		await postLink.waitFor({ state: "visible" });
		const postHref = (await postLink.getAttribute("href")) as string;
		await page.goto(postHref);

		const contentInput = page.locator("[id^='comment-content']");
		await contentInput.waitFor({ state: "visible", timeout: 10000 });
		await contentInput.fill(payload);
		await page.locator('[data-tab="preview"]').click();

		const previewBody = page.locator(".comment-preview");
		await expect(previewBody).toBeVisible({ timeout: 10000 });
		expect(await previewBody.locator("script").count()).toBe(0);
		expect(await previewBody.locator("[onerror]").count()).toBe(0);
		// The payload never executed in the page context.
		const executed = await page.evaluate(() => (window as { __pv?: number }).__pv);
		expect(executed).toBeUndefined();
	});
});
