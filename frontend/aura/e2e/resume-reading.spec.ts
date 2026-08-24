/**
 * Per-post resume reading journey (DEC-167, TASK-200).
 *
 * A signed-in reader's scroll position inside a post is saved server-side
 * (ReadingHistory.scroll_position) so returning to the post drops them back
 * where they left off instead of the top:
 *   1. seed a long published post and register a fresh reader;
 *   2. the reader opens the post, scrolls partway down, and waits out the save
 *      debounce (the offset is persisted via the API);
 *   3. leaving and re-opening the post restores the viewport near the saved
 *      offset and surfaces the resume chip with a back-to-top action.
 */

import { expect, test } from "@playwright/test";

const PASSWORD = "e2epass123";
const stamp = Date.now();
let emailCounter = 0;
function freshEmail(): string {
	emailCounter += 1;
	return `resume-${stamp}-${emailCounter}@example.com`;
}

async function registerReader(
	request: import("@playwright/test").APIRequestContext,
	email: string,
): Promise<string> {
	const resp = await request.post("/api/reader/register", {
		data: { email, password: PASSWORD, display_name: "Resume E2E" },
	});
	expect(resp.status()).toBe(201);
	return ((await resp.json()) as { access_token: string }).access_token;
}

async function adminHeaders(
	request: import("@playwright/test").APIRequestContext,
): Promise<Record<string, string>> {
	// Admin login is an OAuth2 form endpoint (not JSON).
	const login = await request.post("/api/admin/login", {
		form: { username: "admin", password: "admin123" },
	});
	expect(login.ok()).toBe(true);
	const token = ((await login.json()) as { access_token: string }).access_token;
	return { Authorization: `Bearer ${token}` };
}

/** Poll GET /me/history/{post_id} until the saved position satisfies
 * ``predicate`` (the debounced save lags the scroll, so a fixed sleep is
 * flaky under CI latency). Returns the last observed value, or null on
 * timeout — callers assert on the result. */
async function waitForPosition(
	request: import("@playwright/test").APIRequestContext,
	token: string,
	postId: number,
	predicate: (p: number | null) => boolean,
	timeoutMs = 8000,
): Promise<number | null> {
	const deadline = Date.now() + timeoutMs;
	let last: number | null = null;
	while (Date.now() < deadline) {
		const resp = await request.get(`/api/reader/me/history/${postId}`, {
			headers: { Authorization: `Bearer ${token}` },
		});
		if (resp.status() === 200) {
			const body = (await resp.json()) as { scroll_position: number | null };
			last = body.scroll_position;
			if (predicate(last)) return last;
		}
		await new Promise((resolve) => setTimeout(resolve, 300));
	}
	return last;
}

/** A long article so the page is genuinely scrollable (image-free, so the
 * restore is not fighting layout shifts from lazily loaded media). */
function longMarkdown(): string {
	const heading = (i: number) => `## 章节 ${i}\n`;
	const body = (i: number) =>
		`这是第 ${i} 段的占位正文，用于撑高页面高度以便测试滚动定位恢复功能。${"填充内容 ".repeat(20)}\n`;
	const parts = Array.from({ length: 24 }, (_, i) => `${heading(i + 1)}${body(i + 1)}`);
	parts.push("## 结尾\n\n以上就是全部内容。");
	const header = "# 续读定位长文\n\n开篇摘要。\n\n";
	return header + parts.join("\n");
}

test.describe("Per-post resume reading (TASK-200)", () => {
	test("a returning signed-in reader is dropped back where they left off", async ({
		page,
		request,
	}) => {
		// 1. Seed a long published post.
		const headers = await adminHeaders(request);
		const title = `Resume Long Post ${stamp}`;
		const slug = `resume-long-${stamp}`;
		const created = await request.post("/api/admin/posts", {
			data: { title, slug, content: longMarkdown(), excerpt: "resume e2e", published: true },
			headers,
		});
		expect(created.ok()).toBe(true);
		const postId = ((await created.json()) as { id: number }).id;

		// 2. Register a reader and sign the app in.
		const token = await registerReader(request, freshEmail());
		await page.addInitScript((tk) => {
			localStorage.setItem("reader_token", tk);
		}, token);

		// 3. First visit: open the post, wait for the article to reach its full
		// height (content renders client-side), then scroll partway down.
		const url = `/posts/${slug}`;
		await page.goto(url);
		await expect(page.locator("h1").first()).toBeVisible({ timeout: 10000 });
		await page.waitForFunction(() => document.body.scrollHeight > 2000, undefined, {
			timeout: 10000,
		});
		await page.evaluate(() => window.scrollTo({ top: 1500, behavior: "instant" }));
		// Global CSS may set `scroll-behavior: smooth`, so the offset animates
		// instead of applying synchronously — wait until it actually landed.
		await page.waitForFunction(() => window.scrollY > 500, undefined, { timeout: 5000 });

		// 4. The server has the saved offset (poll — the debounced save lags).
		const saved = await waitForPosition(request, token, postId, (p) => p !== null && p >= 1400);
		expect(saved).toBeGreaterThanOrEqual(1400);

		// 5. Leave and come back — the viewport restores to the saved offset.
		await page.goto("/");
		await page.goto(url);
		await page.waitForFunction(() => window.scrollY > 300, undefined, { timeout: 6000 });

		// 6. The resume chip announces the jump and offers back-to-top.
		const chip = page.locator('[role="status"]');
		await expect(chip).toBeVisible({ timeout: 5000 });
		await expect(chip).toContainText("已续读");

		// 7. Back-to-top scrolls up, dismisses the chip, and clears the saved
		// position so the next visit starts at the top (DEC-167 MEDIUM fix).
		await page.locator('[data-testid="resume-back-to-top"]').click();
		await expect(page.locator('[role="status"]')).toBeHidden({ timeout: 4000 });
		const cleared = await waitForPosition(request, token, postId, (p) => p === 0);
		expect(cleared).toBe(0);
	});
});
