/**
 * Tag follow journey (DEC-195, TASK-215).
 *
 * Tags are the fine-grained subscription axis categories are too coarse for: a
 * signed-in reader can follow a tag from the tag page (durable, cross-device),
 * toggle new-post notifications per follow, and manage/unfollow it from the
 * account page. Guests see no reader-level follow control.
 */

import { expect, test } from "@playwright/test";

const PASSWORD = "e2epass123";
let emailCounter = 0;
function freshEmail(): string {
	emailCounter += 1;
	return `tag-follow-${Date.now()}-${emailCounter}@example.com`;
}

function tokenHeader(token: string): Record<string, string> {
	return { Authorization: `Bearer ${token}` };
}

test.describe("Tag follow (TASK-215)", () => {
	test("guests see no reader-level follow control on the tag page", async ({
		page,
		request,
	}) => {
		const tags = await request.get("/api/tags");
		expect(tags.status()).toBe(200);
		const list = (await tags.json()) as Array<{ id: number }>;
		if (!list.length) {
			test.skip();
			return;
		}
		await page.goto(`/tags?tag_id=${list[0].id}`);
		await expect(page.locator("body")).toContainText("标签文章");
		await expect(page.getByRole("button", { name: /关注标签|已关注/ })).toHaveCount(0);
	});

	test("a signed-in reader follows, toggles notifications, and manages from the account page", async ({
		page,
		request,
	}) => {
		const tags = await request.get("/api/tags");
		expect(tags.status()).toBe(200);
		const list = (await tags.json()) as Array<{ id: number; name: string }>;
		if (!list.length) {
			test.skip();
			return;
		}
		const target = list[0];

		// Register a reader and sign the app in.
		const email = freshEmail();
		const reg = await request.post("/api/reader/register", {
			data: { email, password: PASSWORD, display_name: "Tag Follow E2E" },
		});
		expect(reg.status()).toBe(201);
		const token = ((await reg.json()) as { access_token: string }).access_token;
		await page.addInitScript((tk) => localStorage.setItem("reader_token", tk), token);

		// Follow the tag from the tag page.
		await page.goto(`/tags?tag_id=${target.id}`);
		const followBtn = page.getByRole("button", { name: "关注标签" });
		await expect(followBtn).toBeVisible({ timeout: 10000 });
		await followBtn.click();
		await expect(page.getByRole("button", { name: "已关注" })).toBeVisible();
		const notifyOn = page.getByRole("button", { name: "通知已开" });
		await expect(notifyOn).toBeVisible();

		// Toggle notifications off, confirm via the API, then back on.
		await notifyOn.click();
		await expect(page.getByRole("button", { name: "通知已关" })).toBeVisible();
		const silent = await request.get("/api/reader/me/tag-follows", {
			headers: tokenHeader(token),
		});
		const silentData = (await silent.json()) as { items: Array<{ id: number; notify: boolean }> };
		expect(silentData.items.find((t) => t.id === target.id)?.notify).toBe(false);

		await page.getByRole("button", { name: "通知已关" }).click();
		await expect(page.getByRole("button", { name: "通知已开" })).toBeVisible();

		// The account page lists it under Followed tags.
		await page.goto("/account");
		const section = page.locator("section", { hasText: "关注的标签" });
		await expect(section).toBeVisible({ timeout: 10000 });
		await expect(section).toContainText(`#${target.name}`);

		// Unfollow from the account page.
		page.on("dialog", (dialog) => dialog.accept());
		await section.getByRole("button", { name: "取消关注" }).click();
		await expect(section).toContainText("还没有关注任何标签");
	});
});
