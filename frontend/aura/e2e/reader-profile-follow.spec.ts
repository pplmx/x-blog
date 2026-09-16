/**
 * Reader-to-reader follow journey (round 365, DEC-403).
 *
 * A signed-in reader follows another commenter straight from their public
 * profile (/readers/{id}) — the person-shaped cousin of following an author —
 * and, the actual capability, a durable inbox row lands under 通知 when that
 * reader's comment is approved. The public follower count is visible to
 * everyone (guests get the count, no control); /account lists followed readers
 * for a one-click unfollow that drops them back out of the fan-out.
 */

import { expect, test } from "@playwright/test";

let emailCounter = 0;
function freshEmail(): string {
	emailCounter += 1;
	return `rff-${Date.now()}-${emailCounter}@example.com`;
}
const PASSWORD = "e2epass123";
const COMMENTER_NAME = "Fanout Commenter";
const FOLLOWER_NAME = "Follower Bee";

interface ReaderSession {
	access_token: string;
	reader_id: number;
	reader: Record<string, unknown>;
}

async function registerReader(
	request: import("@playwright/test").APIRequestContext,
	name: string,
): Promise<ReaderSession> {
	const resp = await request.post("/api/reader/register", {
		data: { email: freshEmail(), password: PASSWORD, display_name: name },
	});
	expect(resp.status()).toBe(201);
	const body = (await resp.json()) as {
		access_token: string;
		reader: { id: number } & Record<string, unknown>;
	};
	return { access_token: body.access_token, reader_id: body.reader.id, reader: body.reader };
}

async function adminToken(request: import("@playwright/test").APIRequestContext): Promise<string> {
	const login = await request.post("/api/admin/login", {
		form: { username: "admin", password: "admin123" },
	});
	expect(login.status()).toBe(200);
	return (await login.json()).access_token as string;
}

/** Sign a reader session into the browser (reader_token + profile). */
async function signIn(page: import("@playwright/test").Page, session: ReaderSession) {
	await page.addInitScript((s) => {
		localStorage.setItem("reader_token", s.access_token);
		localStorage.setItem("reader_profile", JSON.stringify(s.reader));
	}, session);
}

/** The numeric id of the first public post (the seeded blog's freshest). */
async function firstPostId(request: import("@playwright/test").APIRequestContext): Promise<number> {
	const resp = await request.get("/api/posts?limit=1");
	expect(resp.status()).toBe(200);
	const body = (await resp.json()) as { items: Array<{ id: number }> };
	expect(body.items[0]).toBeTruthy();
	return body.items[0].id;
}

/** Post a reader comment as `token` and approve it as the admin. */
async function postAndApproveReaderComment(
	request: import("@playwright/test").APIRequestContext,
	token: string,
	admin: string,
	postId: number,
	content: string,
) {
	const created = await request.post(`/api/comments/post/${postId}`, {
		data: { content, nickname: COMMENTER_NAME, email: "commenter@example.com" },
		headers: { Authorization: `Bearer ${token}` },
	});
	expect(created.status()).toBe(201);
	const comment = (await created.json()) as { id: number };
	const approved = await request.patch(`/api/comments/${comment.id}/approve`, {
		data: { approved: true },
		headers: { Authorization: `Bearer ${admin}` },
	});
	expect(approved.status()).toBe(200);
	return comment.id;
}

test.describe("Reader-to-reader follow (DEC-403)", () => {
	test("follow from the profile → approved comment lands a fan-out inbox row", async ({
		page,
		request,
	}) => {
		// Three fresh readers: A comments, B follows A, C follows nobody (control).
		const a = await registerReader(request, COMMENTER_NAME);
		const b = await registerReader(request, FOLLOWER_NAME);
		const c = await registerReader(request, "Control Reader");
		await signIn(page, b);
		const admin = await adminToken(request);

		// B opens A's public profile: the count is public, and because B is a
		// signed-in non-self reader a 关注 button is present.
		await page.goto(`/readers/${a.reader_id}`);
		await expect(page.getByText("0 位粉丝")).toBeVisible();
		const followBtn = page.getByRole("button", { name: "关注" });
		await expect(followBtn).toBeVisible();
		await followBtn.click();
		// Server-confirmed toggle: button flips to 已关注, count bumps to 1.
		await expect(page.getByRole("button", { name: "已关注" })).toBeVisible();
		await expect(page.getByText("1 位粉丝")).toBeVisible();

		// The capability: A posts a comment that a moderator approves → B gets a
		// durable reader_comment inbox row.
		const postId = await firstPostId(request);
		await postAndApproveReaderComment(
			request,
			a.access_token,
			admin,
			postId,
			"A follow-worthy take from the round-365 e2e",
		);

		await page.goto("/notifications");
		await expect(page.getByText("通知中心")).toBeVisible({ timeout: 10000 });
		// The fan-out row deep-links to the approved comment. The kind label and
		// the row title are the SAME zh string here ("你关注的读者发表了评论"),
		// so assert on the unique comment anchor instead of the duplicated text.
		await expect(page.locator('a[href*="#comment-"]').first()).toBeVisible({ timeout: 10000 });

		// Control: C, who never followed anyone, has no reader_comment row.
		const cInbox = await request.get("/api/reader/me/notifications", {
			headers: { Authorization: `Bearer ${c.access_token}` },
		});
		expect(cInbox.status()).toBe(200);
		const cRows = (await cInbox.json()) as { items: Array<{ kind: string }> };
		expect(cRows.items.some((r) => r.kind === "reader_comment")).toBe(false);
	});

	test("guests see the follower count but no follow control", async ({ page, request }) => {
		const a = await registerReader(request, `${COMMENTER_NAME} G`);
		const b = await registerReader(request, `${FOLLOWER_NAME} G`);
		// Give A one follower via the API (public count > 0 for a real guest).
		const follow = await request.put(`/api/reader/me/follows/readers/${a.reader_id}`, {
			headers: { Authorization: `Bearer ${b.access_token}` },
		});
		expect(follow.status()).toBe(201);

		// Signed-out browser only ever gets the count.
		await page.goto(`/readers/${a.reader_id}`);
		await expect(page.getByText("1 位粉丝")).toBeVisible();
		await expect(page.getByRole("button", { name: "关注" })).toHaveCount(0);
		await expect(page.getByRole("button", { name: "已关注" })).toHaveCount(0);
	});

	test("unfollow from /account removes the fan-out source", async ({ page, request }) => {
		const a = await registerReader(request, `${COMMENTER_NAME} U`);
		const b = await registerReader(request, `${FOLLOWER_NAME} U`);
		const follow = await request.put(`/api/reader/me/follows/readers/${a.reader_id}`, {
			headers: { Authorization: `Bearer ${b.access_token}` },
		});
		expect(follow.status()).toBe(201);
		await signIn(page, b);

		// /account lists followed readers; unfollow drops the row (with confirm).
		await page.goto("/account");
		const section = page.locator("section").filter({ hasText: "关注的读者" });
		await expect(section.locator(`text=${COMMENTER_NAME} U`)).toBeVisible({ timeout: 10000 });
		page.once("dialog", (d) => d.accept());
		await section.getByRole("button", { name: "取消关注" }).click();
		await expect(section.getByText("还没有关注任何读者")).toBeVisible({ timeout: 10000 });

		// The public count reflects the unfollow.
		const profile = await request.get(`/api/readers/${a.reader_id}`);
		expect(profile.status()).toBe(200);
		const body = (await profile.json()) as {
			profile: { follower_count: number; is_following: boolean };
		};
		expect(body.profile.follower_count).toBe(0);

		// And a follow-up approved comment no longer fans out to B.
		const admin = await adminToken(request);
		const postId = await firstPostId(request);
		await postAndApproveReaderComment(
			request,
			a.access_token,
			admin,
			postId,
			"Post-unfollow comment must not reach B",
		);
		const bInbox = await request.get("/api/reader/me/notifications", {
			headers: { Authorization: `Bearer ${b.access_token}` },
		});
		expect(bInbox.status()).toBe(200);
		const bRows = (await bInbox.json()) as { items: Array<{ kind: string }> };
		// B never followed anyone after the unfollow → zero reader_comment rows.
		expect(bRows.items.some((r) => r.kind === "reader_comment")).toBe(false);
	});
});
