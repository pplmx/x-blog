/**
 * Reading streak + activity heatmap journey (DEC-169, TASK-201).
 *
 * After a signed-in reader views a post today, /history shows the
 * gamification surface fed by the server summary: a current/longest streak
 * card (at least 1 day for today's read) and a 52-week activity heatmap with
 * today's day cell shaded (tooltip includes the localized count).
 *
 * Multi-day streaks cannot be exercised through the API (views record "now"),
 * so the backend contract covers those; this journey proves the surface.
 */

import { expect, test } from "@playwright/test";

const PASSWORD = "e2epass123";
let emailCounter = 0;
function freshEmail(): string {
	emailCounter += 1;
	return `streak-${Date.now()}-${emailCounter}@example.com`;
}

async function registerReader(
	request: import("@playwright/test").APIRequestContext,
	email: string,
): Promise<string> {
	const resp = await request.post("/api/reader/register", {
		data: { email, password: PASSWORD, display_name: "Streak E2E" },
	});
	expect(resp.status()).toBe(201);
	return ((await resp.json()) as { access_token: string }).access_token;
}

test.describe("Reading streak + activity (TASK-201)", () => {
	test("a read today lights the streak card and the heatmap on /history", async ({
		page,
		request,
	}) => {
		const token = await registerReader(request, freshEmail());
		await page.addInitScript((tk) => {
			localStorage.setItem("reader_token", tk);
		}, token);

		// View a post so today has a read.
		await page.goto("/");
		const postLink = page.locator("main a[href*='/posts/']").first();
		await postLink.waitFor({ state: "visible" });
		const href = (await postLink.getAttribute("href")) ?? "";
		await page.goto(href);
		await page.waitForURL(/\/posts\//);

		// The gamification surface on /history.
		await page.goto("/history");
		await expect(page.locator("h1").first()).toBeVisible({ timeout: 10000 });
		await expect(page.locator("body")).toContainText("连续阅读");
		// The longest-streak caption is always populated (>= 1 day here).
		await expect(page.locator("body").getByText(/最长 \d+ 天/)).toBeVisible({
			timeout: 5000,
		});
		await expect(page.locator("body")).toContainText("阅读活跃度（近一年）");

		// Today's day cell is shaded and carries a count tooltip (the cell's
		// text is empty, so match the title attribute with a substring CSS attr).
		const litCell = page.locator('[title*="篇"]').first();
		await expect(litCell).toBeVisible({ timeout: 5000 });
	});
});

// Timezone-pinned journey (DEC-316/TASK-386): the streak and 52-week heatmap
// previously bucketed reads in UTC while the page rendered them in local time,
// so every non-UTC reader's "today" and tooltip dates disagreed with their own
// calendar. Now the stats fetch declares the browser's timezone and the backend
// anchors to the reader's local day.
//
// The discriminator is subtle: the OLD pipeline showed, for a read in zone Z,
// the local rendition of the UTC bucket's midnight — and that can COINCIDE with
// the read's local date (the label re-shift mirrors the bucket shift in some
// zones/hours). For a west zone with offset −k, the old label is always
// utcDate−−1 whenever the read's UTC time is ≥ k hours, while the new label is
// the read's local date (utcDate). So **UTC−1 ("Etc/GMT+1") discriminates for
// any run time past 01:00 UTC**: old shows utcDate−1, new shows utcDate. Only
// the exact first minute of the UTC day (00:00–01:00) has no discriminating
// offset, so the test skips there (1/1440 odds).
const now = new Date();
const utcDate = now.toISOString().slice(0, 10);
const utcHourFraction = (now.getTime() / 3_600_000) % 24;
const pinnedZone = utcHourFraction >= 1 ? "Etc/GMT+1" : null;

test.describe("Reading streak + activity, timezone-pinned (DEC-316/TASK-386)", () => {
	test.use({ timezoneId: pinnedZone ?? "UTC" });
	if (!pinnedZone) {
		test.skip("inside the 00:00–01:00 UTC window where no offset discriminates");
	}

	test("a read today is credited to the reader's LOCAL calendar day, not UTC", async ({
		page,
		request,
	}) => {
		const token = await registerReader(request, freshEmail());
		await page.addInitScript((tk) => {
			localStorage.setItem("reader_token", tk);
		}, token);

		// View a post so "now" gets a server-backed read.
		await page.goto("/");
		const postLink = page.locator("main a[href*='/posts/']").first();
		await postLink.waitFor({ state: "visible" });
		await page.goto((await postLink.getAttribute("href")) ?? "");
		await page.waitForURL(/\/posts\//);

		await page.goto("/history");
		await expect(page.locator("h1").first()).toBeVisible({ timeout: 10000 });

		// The last heatmap cell is today (the backend window ends at local
		// today). In UTC−1 the read's local date is the UTC date, so the
		// expected LOCAL label is utcDate rendered in the pinned zone — and the
		// stale UTC-only implementation would show utcDate−1 instead.
		const readTime = new Date();
		const labelFmt = new Intl.DateTimeFormat("zh-CN", {
			timeZone: pinnedZone,
			year: "numeric",
			month: "short",
			day: "numeric",
		});
		const localLabel = labelFmt.format(readTime); // utcDate (the read's local day)
		const utcOnlyLabel = labelFmt.format(new Date(`${utcDate}T00:00:00Z`)); // utcDate−1

		const todayCell = page.locator('[title*="篇"]').last();
		await expect(todayCell).toBeVisible({ timeout: 5000 });
		const title = (await todayCell.getAttribute("title")) ?? "";
		expect(title).toContain(localLabel);
		// The rigorous half: the UTC-only label (utcDate−1) must NOT appear in
		// today's cell — the bucket (and thus the tooltip) must be the reader's
		// local day, and a reverted UTC-bucketing fails this deterministically.
		expect(title).not.toContain(utcOnlyLabel);
	});
});
