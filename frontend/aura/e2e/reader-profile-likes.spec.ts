/**
 * Opt-in public liked-posts profile tab journey (round 360, DEC-393).
 *
 * The first reader-to-reader discovery surface: a signed-in reader flips the
 * public-likes opt-in on /account, and their public /readers/{id} profile
 * gains a "Liked posts" tab that ANYONE (guest included) can browse — the
 * posts they liked are visible without sign-in. Default posture holds: a
 * reader who never opts in gets no tab at all, and opting back out removes
 * it (the public endpoint 404s, so nothing leaks).
 */

import { expect, test } from "@playwright/test";

let emailCounter = 0;
function freshEmail(): string {
	emailCounter += 1;
	return `reader-${Date.now()}-${emailCounter}@example.com`;
}
const PASSWORD = "e2epass123";

async function registerReader(
	request: import("@playwright/test").APIRequestContext,
	email: string,
): Promise<{ access_token: string; reader_id: number; reader: Record<string, unknown> }> {
	const resp = await request.post("/api/reader/register", {
		data: { email, password: PASSWORD, display_name: "Taste Reader" },
	});
	expect(resp.status()).toBe(201);
	const body = (await resp.json()) as {
		access_token: string;
		reader: { id: number } & Record<string, unknown>;
	};
	return { access_token: body.access_token, reader_id: body.reader.id, reader: body.reader };
}

// Seed the FULL session (token + profile) — useReaderAuth only reads the
// profile from localStorage, so a bare token leaves reader null and the
// /account profile form would render an empty (unsaveable) display name.
async function signIn(page: import("@playwright/test").Page, session: {
	access_token: string;
	reader: Record<string, unknown>;
}) {
	await page.addInitScript((s) => {
		localStorage.setItem("reader_token", s.access_token);
		localStorage.setItem("reader_profile", JSON.stringify(s.reader));
	}, session);
}

/** Open the first published post page and like it; returns its href. */
async function likeFirstPost(page: import("@playwright/test").Page): Promise<string> {
	await page.goto("/");
	const postLink = page.locator("main a[href*='/posts/']").first();
	await postLink.waitFor({ state: "visible" });
	const href = (await postLink.getAttribute("href")) as string;
	await page.goto(href);
	await page.locator("button[title='喜欢']").first().click();
	await expect(page.locator("button[title='已点赞']").first()).toBeVisible({ timeout: 5000 });
	return href;
}

test.describe("Public liked-posts profile tab (DEC-393)", () => {
	test("opt in on /account → the public profile gained a tab a guest can browse", async ({
		page,
		request,
	}) => {
		const session = await registerReader(request, freshEmail());
		const { reader_id } = session;
		await signIn(page, session);

		// Like a post as this reader.
		const href = await likeFirstPost(page);

		// Flip the opt-in on /account (default is off, so the tab must appear
		// only after this — not before).
		await page.goto("/account");
		const toggle = page.getByText("在我的公开主页展示我喜欢的文章");
		await toggle.waitFor({ state: "visible", timeout: 5000 });
		// The label wraps the checkbox — clicking the label toggles it.
		await toggle.click();
		await page
			.locator("form")
			.filter({ hasText: "我的公开主页" })
			.getByRole("button", { name: "保存" })
			.click();
		await expect(page.getByText("已保存")).toBeVisible({ timeout: 5000 });

		// Server agrees: the flag is on and the public likes endpoint lists it.
		const profile = await request.get(`/api/readers/${reader_id}`);
		expect(profile.status()).toBe(200);
		expect((await profile.json()).profile.public_likes).toBe(true);
		const publicLikes = await request.get(`/api/readers/${reader_id}/likes`);
		expect(publicLikes.status()).toBe(200);
		const listBody = (await publicLikes.json()) as { items: { slug: string }[] };
		expect(listBody.items.some((p) => p.slug === href.replace("/posts/", ""))).toBe(true);

		// Signed-in view: the profile gained a "Liked posts" tab.
		await page.goto(`/readers/${reader_id}`);
		await expect(page.getByRole("tab", { name: "喜欢的文章" })).toBeVisible({ timeout: 5000 });
		await page.getByRole("tab", { name: "喜欢的文章" }).click();
		await expect(page.locator(`main a[href="${href}"]`)).toBeVisible({ timeout: 5000 });
	});

	test("a guest browses the published tab; opting out removes it (no leak)", async ({
		page,
		request,
	}) => {
		const { access_token, reader_id } = await registerReader(request, freshEmail());

		// Opt in via the API (the /account UI is covered above).
		const patch = await request.patch("/api/reader/me", {
			headers: { Authorization: `Bearer ${access_token}` },
			data: { public_likes: true },
		});
		expect(patch.status()).toBe(200);

		// Like a post via the API and confirm it is published.
		const postList = await request.get("/api/posts?limit=1");
		const post = ((await postList.json()) as { items: { id: number; slug: string }[] }).items[0];
		expect(post).toBeTruthy();
		const like = await request.post(`/api/reader/me/likes/${post.id}`, {
			headers: { Authorization: `Bearer ${access_token}` },
		});
		expect(like.status()).toBe(201);

		// Guest: NO reader token — the tab is browseable without sign-in.
		await page.goto(`/readers/${reader_id}`);
		await expect(page.getByRole("tab", { name: "喜欢的文章" })).toBeVisible({ timeout: 5000 });
		await page.getByRole("tab", { name: "喜欢的文章" }).click();
		const card = page.locator(`main a[href="/posts/${post.slug}"]`);
		await expect(card).toBeVisible({ timeout: 5000 });

		// Opt back out — the public surface disappears, no residual leak.
		const unpatch = await request.patch("/api/reader/me", {
			headers: { Authorization: `Bearer ${access_token}` },
			data: { public_likes: false },
		});
		expect(unpatch.status()).toBe(200);
		expect((await request.get(`/api/readers/${reader_id}/likes`)).status()).toBe(404);
		await page.goto(`/readers/${reader_id}`);
		await expect(page.getByRole("tab", { name: "喜欢的文章" })).toHaveCount(0);
	});

	test("a reader who never opts in gets no Likes tab", async ({ page, request }) => {
		const session = await registerReader(request, freshEmail());
		const { reader_id } = session;
		await signIn(page, session);
		await likeFirstPost(page);

		await page.goto(`/readers/${reader_id}`);
		await expect(page.getByRole("tab", { name: "喜欢的文章" })).toHaveCount(0);
		// The comments tab is still there.
		await expect(page.getByRole("tab", { name: "评论" }).first()).toBeVisible({ timeout: 5000 });
		// And the public endpoint stays a 404 (no oracle).
		const res = await request.get(`/api/readers/${reader_id}/likes`);
		expect(res.status()).toBe(404);
	});
});
