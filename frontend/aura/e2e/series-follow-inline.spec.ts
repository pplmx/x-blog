/**
 * In-place series-follow on the post page (DEC-290, TASK-374).
 *
 * Series-follow (follow the series for a push when a new part is published,
 * DEC-132/TASK-178) was only reachable from /series/[slug]. On the post page
 * the in-series nav box renders prev/next without any follow control — a
 * reader landing on part 3 of a series (via search/related/prev-next) had to
 * leave the post to subscribe to future parts. This closes that gap exactly
 * the way DEC-196 closed it for tags: a signed-in reader follows/unfollows the
 * series and toggles new-part notifications in place, and it reflects in the
 * account page's Followed-series section. Guests see no control.
 */

import { expect, test } from "@playwright/test";

const PASSWORD = "e2epass123";
let emailCounter = 0;
function freshEmail(): string {
	emailCounter += 1;
	return `series-inline-${Date.now()}-${emailCounter}@example.com`;
}

function tokenHeader(token: string): Record<string, string> {
	return { Authorization: `Bearer ${token}` };
}

const FOLLOW = "有新篇时通知我";
const FOLLOWING = "已关注新篇";
const NOTIFY_ON = "通知已开";
const NOTIFY_OFF = "通知已关";
/** Account-page Followed-series section selectors (shared with series-follow.spec). */
const EMPTY_SERIES_TEXT = "还没有关注任何系列";

async function pickSeriesPost(request: import("@playwright/test").APIRequestContext) {
	// Find a series with a published post, then return one of its post slugs.
	// The /api/series list includes e2e-created series left behind by other
	// specs (post_count 0), so iterate rather than trusting the first entry.
	const list = await request.get("/api/series");
	expect(list.status()).toBe(200);
	const series = (await list.json()) as Array<{ slug: string; post_count?: number }>;
	if (!series.length) return null;
	for (const s of series) {
		if ((s.post_count ?? 0) === 0) continue; // skip empty e2e leftovers
		const detail = await request.get(`/api/series/${s.slug}`);
		if (detail.status() !== 200) continue;
		const data = (await detail.json()) as {
			posts: Array<{ slug: string; published?: boolean }>;
		};
		// The public detail returns the series posts in order; pick one that is
		// actually published and live (skip drafts/scheduled).
		const slug = data.posts.find((p) => p.published !== false)?.slug;
		if (slug) return slug;
	}
	return null;
}

test.describe("In-place series follow on the post page (TASK-374)", () => {
	test("guests see no in-place series-follow control on a post page", async ({ page, request }) => {
		const slug = await pickSeriesPost(request);
		if (!slug) {
			test.skip();
			return;
		}
		await page.goto(`/posts/${slug}`);
		// The in-series nav box renders (its aria-label is the zh "本系列文章"),
		// but no follow / notify toggle inside it.
		await expect(page.locator('nav[aria-label="本系列文章"]')).toBeVisible({ timeout: 10000 });
		await expect(
			page.getByRole("button", {
				name: new RegExp(`${FOLLOW}|${FOLLOWING}|${NOTIFY_ON}|${NOTIFY_OFF}`),
			}),
		).toHaveCount(0);
	});

	test("a signed-in reader follows the series from the post, toggles notify, and manages it from the account page", async ({
		page,
		request,
	}) => {
		const slug = await pickSeriesPost(request);
		if (!slug) {
			test.skip();
			return;
		}

		// Register a reader and sign the app in.
		const email = freshEmail();
		const reg = await request.post("/api/reader/register", {
			data: { email, password: PASSWORD, display_name: "Inline Series Follow E2E" },
		});
		expect(reg.status()).toBe(201);
		const token = ((await reg.json()) as { access_token: string }).access_token;
		await page.addInitScript((tk) => localStorage.setItem("reader_token", tk), token);

		// Follow the series from the in-series nav box on the post page.
		await page.goto(`/posts/${slug}`);
		const nav = page.locator('nav[aria-label="本系列文章"]');
		await expect(nav).toBeVisible({ timeout: 10000 });
		const followBtn = nav.getByRole("button", { name: new RegExp(FOLLOW) });
		await expect(followBtn).toBeVisible();
		await followBtn.click();
		await expect(nav.getByRole("button", { name: new RegExp(FOLLOWING) })).toBeVisible();
		await expect(nav.getByRole("button", { name: new RegExp(NOTIFY_ON) })).toBeVisible();

		// Toggle new-part notifications off via the in-place control, confirm via
		// the API, then back on.
		await nav.getByRole("button", { name: new RegExp(NOTIFY_ON) }).click();
		await expect(nav.getByRole("button", { name: new RegExp(NOTIFY_OFF) })).toBeVisible();
		const silent = await request.get("/api/reader/me/series-follows", {
			headers: tokenHeader(token),
		});
		expect(silent.status()).toBe(200);
		const silentData = (await silent.json()) as {
			items: Array<{ id: number; notify: boolean }>;
		};
		// The reader follows exactly the series they just followed in place.
		expect(silentData.items.length).toBe(1);
		expect(silentData.items[0].notify).toBe(false);
		await nav.getByRole("button", { name: new RegExp(NOTIFY_OFF) }).click();
		await expect(nav.getByRole("button", { name: new RegExp(NOTIFY_ON) })).toBeVisible();

		// The account page lists it under Followed series (the follow persisted).
		await page.goto("/account");
		const section = page.locator("section", { hasText: "关注的系列" });
		await expect(section).toBeVisible({ timeout: 10000 });
		await expect(section).not.toContainText(EMPTY_SERIES_TEXT);

		// Unfollow from the post page, confirm the account is empty again.
		await page.goto(`/posts/${slug}`);
		await nav.getByRole("button", { name: new RegExp(FOLLOWING) }).click();
		await expect(nav.getByRole("button", { name: new RegExp(FOLLOW) })).toBeVisible();
		await page.goto("/account");
		await expect(section).toContainText(EMPTY_SERIES_TEXT, { timeout: 10000 });
	});
});
