/**
 * Account "Followed series" journey (DEC-134, TASK-179).
 *
 * A signed-in reader sees every series they follow for new-part push on the
 * account page and can unfollow from there; the change is reflected both in
 * the UI and in the reader's own series-follows API. Guests see no section.
 */

import { expect, test } from "@playwright/test";

const PASSWORD = "e2epass123";
let emailCounter = 0;
function freshEmail(): string {
	emailCounter += 1;
	return `acc-series-${Date.now()}-${emailCounter}@example.com`;
}

function tokenHeader(token: string): Record<string, string> {
	return { Authorization: `Bearer ${token}` };
}

test.describe("Account followed series (TASK-179)", () => {
	test("guests see no followed-series section on the account page", async ({ page }) => {
		await page.goto("/account");
		await expect(page.locator("section", { hasText: "关注的系列" })).toHaveCount(0);
	});

	test("a signed-in reader sees and unfollows their followed series", async ({ page, request }) => {
		const series = await request.get("/api/series");
		expect(series.status()).toBe(200);
		const list = (await series.json()) as Array<{ id: number; slug: string }>;
		if (!list.length) {
			test.skip();
			return;
		}
		const target = list[0];

		// Register a reader, sign the app in, and follow the series.
		const email = freshEmail();
		const reg = await request.post("/api/reader/register", {
			data: { email, password: PASSWORD, display_name: "Acc Series E2E" },
		});
		expect(reg.status()).toBe(201);
		const token = ((await reg.json()) as { access_token: string }).access_token;
		await page.addInitScript((tk) => localStorage.setItem("reader_token", tk), token);

		const follow = await request.put(`/api/reader/me/series/${target.id}/follow`, {
			headers: tokenHeader(token),
		});
		expect(follow.status()).toBe(201);

		// The account page lists the followed series with a link to it.
		await page.goto("/account");
		const section = page.locator("section", { hasText: "关注的系列" });
		await expect(section).toBeVisible({ timeout: 10000 });
		await expect(section.locator(`a[href="/series/${target.slug}"]`).first()).toBeVisible();

		// Unfollow from the account page (accept the confirm dialog).
		page.on("dialog", (dialog) => dialog.accept());
		await section.getByRole("button", { name: "取消关注" }).click();
		await expect(section.getByRole("button", { name: "取消关注" })).toHaveCount(0);
		await expect(section).toContainText("还没有关注任何系列");

		// The reader's own API no longer lists it.
		const after = await request.get("/api/reader/me/series-follows", {
			headers: tokenHeader(token),
		});
		const afterData = (await after.json()) as { items: Array<{ id: number }> };
		expect(afterData.items.map((f) => f.id)).not.toContain(target.id);
	});
});
