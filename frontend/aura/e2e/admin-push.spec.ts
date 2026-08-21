/**
 * Comment-moderation alerts admin journey (DEC-080, TASK-152).
 *
 * The blog moderates every comment; an admin can opt this browser into a push
 * that fires when a new comment awaits approval, deep-linking to
 * /admin/comments. This spec pins the admin-gated UI: the toggle always lives
 * in the admin sidebar, and whenever delivery is impossible — no VAPID
 * (the default `just e2e` harness) OR the browser blocked notification
 * permission — it is disabled with an explanatory tooltip instead of silently
 * no-op enabling (matching ThreadSubscribeButton's never-a-silent-no-op
 * gating). When VAPID is configured AND permission is granted, the real
 * journey runs: subscribe → subscribed. The push contract itself
 * (register/unregister/dispatch on pending comment create, deep-link) is
 * pinned by the backend pytest suite (tests/test_admin_push_moderation.py)
 * and the component tests (AdminPushToggle.spec.ts).
 */

import { expect, test } from "@playwright/test";

/** The admin sidebar moderation-alert toggle. Anchored on the always-rendered
 * hint paragraph's container (the button label varies by status — e.g. the
 * disabled "通知已被浏览器阻止"/"Notifications blocked by browser" state),
 * not on any single label text. */
function toggle(page: import("@playwright/test").Page) {
	return page
		.locator("aside div", { hasText: /推送提醒|push|awaits|alert/i })
		.locator("button")
		.first();
}

async function signInAdmin(page: import("@playwright/test").Page) {
	await page.goto("/admin/login");
	await page.fill('input[type="text"]', "admin");
	await page.fill('input[type="password"]', "admin123");
	await page.click('button[type="submit"]');
	await page.waitForURL("**/admin/posts");
}

test.describe("Comment-moderation alerts (admin-gated UI)", () => {
	test("the moderation-alert toggle renders in the admin sidebar", async ({ page }) => {
		await signInAdmin(page);
		const btn = toggle(page);
		await expect(btn).toBeVisible();
	});

	test("toggle is gated on push readiness: disabled+hint or a real enable", async ({ page }) => {
		await signInAdmin(page);
		const btn = toggle(page);
		await expect(btn).toBeVisible();

		if (await btn.isDisabled()) {
			// No delivery is possible (no VAPID in the default harness, or the
			// browser blocked permission): the toggle must be a disabled button
			// with an explanatory tooltip, never a silent no-op.
			await expect(btn).toHaveAttribute("title", /推送|提醒|push|alert|blocked/i);
			return;
		}

		// VAPID configured + permission granted: complete the real journey
		// (subscribe → subscribed).
		await btn.click();
		await expect(toggle(page)).toHaveAttribute("aria-label", /已开启|on/i, {
			timeout: 10_000,
		});
	});
});
