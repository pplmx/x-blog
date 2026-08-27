/**
 * Inline tag-follow on the post page (DEC-196, TASK-216).
 *
 * The tag chips in a post's footer are followable in place: a signed-in reader
 * follows/unfollows the tag and toggles its new-post notifications without
 * leaving the post, and it reflects in the account page's Followed-tags
 * section. Guests see no reader-level follow control on the chips.
 */

import { expect, test } from "@playwright/test";

const PASSWORD = "e2epass123";
let emailCounter = 0;
function freshEmail(): string {
	emailCounter += 1;
	return `tag-inline-${Date.now()}-${emailCounter}@example.com`;
}

function tokenHeader(token: string): Record<string, string> {
	return { Authorization: `Bearer ${token}` };
}

const FOLLOW_TITLE = "关注该标签，新文章发布时通知我";
const FOLLOWING_TITLE = "取消关注该标签";
const NOTIFY_ON = "通知已开";
const NOTIFY_OFF = "通知已关";

async function pickTaggedPost(request: import("@playwright/test").APIRequestContext) {
	const r = await request.get("/api/posts?limit=50");
	expect(r.status()).toBe(200);
	const data = (await r.json()) as {
		items: Array<{ slug: string; tags: Array<{ id: number; name: string }> }>;
	};
	return data.items.find((p) => (p.tags?.length ?? 0) > 0) ?? null;
}

test.describe("Inline tag follow on the post page (TASK-216)", () => {
	test("guests see no in-place tag-follow control on a post page", async ({ page, request }) => {
		const post = await pickTaggedPost(request);
		if (!post) {
			test.skip();
			return;
		}
		await page.goto(`/posts/${post.slug}`);
		// The chip links exist (public), but no follow/notify buttons render.
		await expect(page.getByRole("link", { name: post.tags[0].name })).toBeVisible();
		await expect(
			page.getByRole("button", {
				name: new RegExp(`${FOLLOW_TITLE}|${FOLLOWING_TITLE}|${NOTIFY_ON}|${NOTIFY_OFF}`),
			}),
		).toHaveCount(0);
	});

	test("a signed-in reader follows a tag from the post footer, toggles notify, and manages it from the account page", async ({
		page,
		request,
	}) => {
		const post = await pickTaggedPost(request);
		if (!post) {
			test.skip();
			return;
		}
		const target = post.tags[0];

		// Register a reader and sign the app in.
		const email = freshEmail();
		const reg = await request.post("/api/reader/register", {
			data: { email, password: PASSWORD, display_name: "Inline Tag Follow E2E" },
		});
		expect(reg.status()).toBe(201);
		const token = ((await reg.json()) as { access_token: string }).access_token;
		await page.addInitScript((tk) => localStorage.setItem("reader_token", tk), token);

		// Follow the tag from the post footer chip.
		await page.goto(`/posts/${post.slug}`);
		// Scope every interaction to the chip for the specific tag: posts with
		// several tags render several (identical) controls, one per chip.
		const chip = page.locator(`footer span[title="${target.name}"]`);
		const followBtn = chip.getByRole("button", { name: new RegExp(FOLLOW_TITLE) });
		await expect(followBtn).toBeVisible({ timeout: 10000 });
		await followBtn.click();
		await expect(chip.getByRole("button", { name: new RegExp(FOLLOWING_TITLE) })).toBeVisible();
		await expect(chip.getByRole("button", { name: new RegExp(NOTIFY_ON) })).toBeVisible();

		// Toggle notifications off via the chip, confirm via the API, then on.
		await chip.getByRole("button", { name: new RegExp(NOTIFY_ON) }).click();
		await expect(chip.getByRole("button", { name: new RegExp(NOTIFY_OFF) })).toBeVisible();
		const silent = await request.get("/api/reader/me/tag-follows", {
			headers: tokenHeader(token),
		});
		const silentData = (await silent.json()) as { items: Array<{ id: number; notify: boolean }> };
		expect(silentData.items.find((t) => t.id === target.id)?.notify).toBe(false);

		await chip.getByRole("button", { name: new RegExp(NOTIFY_OFF) }).click();
		await expect(chip.getByRole("button", { name: new RegExp(NOTIFY_ON) })).toBeVisible();

		// The account page lists it under Followed tags.
		await page.goto("/account");
		const section = page.locator("section", { hasText: "关注的标签" });
		await expect(section).toBeVisible({ timeout: 10000 });
		await expect(section).toContainText(`#${target.name}`);

		// Unfollow from the post footer chip, then confirm the account is empty.
		await page.goto(`/posts/${post.slug}`);
		await chip.getByRole("button", { name: new RegExp(FOLLOWING_TITLE) }).click();
		await expect(chip.getByRole("button", { name: new RegExp(FOLLOW_TITLE) })).toBeVisible();
		await page.goto("/account");
		await expect(section).toContainText("还没有关注任何标签", { timeout: 10000 });
	});
});
