/**
 * Comment-thread subscription journey (DEC-078, TASK-150).
 *
 * A signed-in reader sees the "Follow discussion" toggle on a post's comments
 * header and manages those follows on the account page. This spec pins the
 * reader-gated UI: anonymous visitors never see the toggle; a signed-in one
 * does; and under the repo's default `just e2e` harness (no VAPID env) the
 * toggle is disabled with an explanatory tooltip instead of silently no-op
 * following. The follow/unfollow push contract itself is pinned by the
 * backend pytest suite (tests/test_comment_subscriptions.py) and the
 * component tests (ThreadSubscribeButton.spec.ts).
 */

import { expect, test } from "@playwright/test";

let emailCounter = 0;
function freshEmail(): string {
	emailCounter += 1;
	return `thread-${Date.now()}-${emailCounter}@example.com`;
}
const PASSWORD = "e2epass123";

async function registerReader(
	request: import("@playwright/test").APIRequestContext,
	email: string,
) {
	const resp = await request.post("/api/reader/register", {
		data: { email, password: PASSWORD, display_name: "E2E Thread Follower" },
	});
	expect(resp.status()).toBe(201);
	return (await resp.json()) as {
		access_token: string;
		reader: { id: number; email: string; display_name: string };
	};
}

/** Seed the reader session directly from the register response. */
async function signInReader(
	page: import("@playwright/test").Page,
	request: import("@playwright/test").APIRequestContext,
): Promise<{ email: string }> {
	const email = freshEmail();
	const { access_token, reader } = await registerReader(request, email);
	await page.goto("/");
	await page.evaluate(
		([token, profile]) => {
			localStorage.setItem("reader_token", token);
			localStorage.setItem("reader_profile", JSON.stringify(profile));
		},
		[access_token, reader] as const,
	);
	return { email };
}

/** Open the first published post's detail page and return its href. */
async function openFirstPost(page: import("@playwright/test").Page): Promise<string> {
	await page.goto("/");
	const postLink = page.locator("main a[href*='/posts/']").first();
	await postLink.waitFor({ state: "visible" });
	const href = await postLink.getAttribute("href");
	if (!href) throw new Error("no post link on homepage");
	await page.goto(href);
	await page.locator("section").filter({ hasText: "评论" }).first().waitFor({ state: "visible" });
	return href;
}

test.describe("Comment-thread subscription (reader-gated UI)", () => {
	test("anonymous visitors never see the follow-discussion toggle", async ({ page }) => {
		await openFirstPost(page);
		await expect(page.locator("button", { hasText: "订阅讨论" })).toHaveCount(0);
	});

	test("a signed-in reader sees the follow-discussion toggle on a post", async ({
		page,
		request,
	}) => {
		await signInReader(page, request);
		await openFirstPost(page);
		await expect(page.locator("button", { hasText: "订阅讨论" })).toBeVisible();
	});

	test("follow is gated on push readiness: disabled+hint or a real follow", async ({
		page,
		request,
	}) => {
		// The repo's default e2e harness runs the backend without VAPID keys
		// (`just e2e`), so the browser cannot register for push and the follow
		// must be a disabled button with an explanatory tooltip — never a silent
		// no-op follow. When VAPID IS configured the real journey runs: follow →
		// the account page lists the thread → unfollow.
		await signInReader(page, request);
		const href = await openFirstPost(page);
		const btn = page.locator("button", { hasText: "订阅讨论" });
		await expect(btn).toBeVisible();

		if ((await btn.getAttribute("disabled")) !== null) {
			await expect(btn).toHaveAttribute("title", /开启浏览器通知/);
			return;
		}

		// VAPID configured: this browser can push, so complete the journey.
		await btn.click();
		await expect(page.locator("button", { hasText: "已订阅" })).toBeVisible({ timeout: 10_000 });

		await page.goto("/account");
		await expect(page.locator("h2", { hasText: "订阅的讨论" })).toBeVisible();
		await expect(page.locator(`a[href="${href}"]`).first()).toBeVisible({ timeout: 5000 });

		// Unfollow with the confirm dialog accepted.
		page.once("dialog", (dialog) => void dialog.accept());
		await page.locator("button", { hasText: "取消订阅" }).first().click();
		await expect(page.locator("text=还没有订阅任何讨论")).toBeVisible({ timeout: 5000 });
	});

	test("account page lists the followed-discussions section (empty state)", async ({
		page,
		request,
	}) => {
		await signInReader(page, request);
		await page.goto("/account");
		await expect(page.locator("h2", { hasText: "订阅的讨论" })).toBeVisible();
		await expect(page.locator("text=还没有订阅任何讨论")).toBeVisible();
	});
});
