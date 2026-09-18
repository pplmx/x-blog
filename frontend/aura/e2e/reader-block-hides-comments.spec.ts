/**
 * Blocked readers' comments hidden from the blocker (round 386, DEC-437).
 *
 * Round 379 (DEC-425) shipped reader blocking as a receiver-side opt-out: it
 * suppressed the notification fan-outs but a blocked reader's comments still
 * rendered in the post thread, the discussion feed and comment search — the
 * DEC-425 rationale promises "a blocked commenter is invisible to them even
 * mid-thread", which was only true of the notification path. This spec closes
 * that loop on the render path: two readers comment on a public post, an admin
 * approves both, the blocker signs in and sees both; after blocking the target
 * from the target's public profile, the blocker revisits the post and the
 * target's comment is gone while the unblocked control's comment remains.
 * Uses the live backend seeded by `just e2e` + the Nuxt dev server.
 */

import { type APIRequestContext, expect, test } from "@playwright/test";

interface ReaderSession {
	access_token: string;
	reader_id: number;
	reader: Record<string, unknown>;
}

const PASSWORD = "pass12345";
let counter = 0;
function freshEmail(): string {
	counter += 1;
	return `block-hide-${Date.now()}-${counter}@example.com`;
}

async function registerReader(request: APIRequestContext, name: string): Promise<ReaderSession> {
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

async function adminToken(request: APIRequestContext): Promise<string> {
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

/** Approve a comment under the post (every comment is moderated, DEC-066). */
async function approveComment(
	request: APIRequestContext,
	adminH: Record<string, string>,
	commentId: number,
): Promise<void> {
	const approve = await request.patch(`/api/comments/${commentId}/approve`, {
		headers: adminH,
		data: { approved: true },
	});
	expect(approve.status()).toBe(200);
}

/** Post a comment as a signed-in reader and approve it (DEC-066 moderation).
 *  Non-empty nickname/email placeholders are required even though a signed-in
 *  reader's identity is stamped from the JWT and those values are ignored. */
async function postAndApproveComment(
	request: APIRequestContext,
	token: string,
	adminH: Record<string, string>,
	postId: number,
	content: string,
): Promise<number> {
	const created = await request.post(`/api/comments/post/${postId}`, {
		data: { nickname: "x", email: "x@example.com", content },
		headers: { Authorization: `Bearer ${token}` },
	});
	expect(created.status()).toBe(201);
	const comment = (await created.json()) as { id: number };
	await approveComment(request, adminH, comment.id);
	return comment.id;
}

test.describe("Blocked readers' comments hidden (DEC-437)", () => {
	test.skip(() => !!process.env.CI_RESTRICTED, "full journey requires admin publish");

	test("block from the profile hides the target's comment but keeps the control's", async ({
		page,
		request,
	}) => {
		const adminTok = await adminToken(request);
		const adminH = { Authorization: `Bearer ${adminTok}` };
		const uid = Date.now();
		const postSlug = `block-hide-e2e-${uid}`;
		const blocker = await registerReader(request, `Blocker ${uid}`);
		const target = await registerReader(request, `Target ${uid}`);
		const control = await registerReader(request, `Control ${uid}`);

		// A public post with room for the discussion.
		const post = await request.post("/api/posts", {
			headers: adminH,
			data: {
				title: `Block hide ${uid}`,
				slug: postSlug,
				content: "# Hello",
				published: true,
			},
		});
		expect(post.status()).toBe(201);
		const postId = ((await post.json()) as { id: number }).id;

		// Run-unique comment text (the discussion feed aggregates every test run's
		// comments into the same page, so plain shared labels would be ambiguous).
		const targetText = `the TARGET comment ${uid}`;
		const controlText = `the CONTROL comment ${uid}`;
		const tId = await postAndApproveComment(
			request,
			target.access_token,
			adminH,
			postId,
			targetText,
		);
		const cId = await postAndApproveComment(
			request,
			control.access_token,
			adminH,
			postId,
			controlText,
		);
		expect(tId).toBeGreaterThan(0);
		expect(cId).toBeGreaterThan(0);

		// The blocker initially sees both comments on the post.
		await signIn(page, blocker);
		await page.goto(`/posts/${postSlug}`);
		await page.locator("main").getByText(targetText).waitFor();
		await page.locator("main").getByText(controlText).waitFor();

		// Block the target from their public profile (the DEC-425 entry point).
		// Blocking is a safety action: accept the one-time confirm, then wait for
		// the button flip so the PUT has landed before we navigate away.
		await page.goto(`/readers/${target.reader_id}`);
		const blockBtn = page.getByRole("button", { name: "屏蔽", exact: true });
		await expect(blockBtn).toBeVisible();
		page.once("dialog", (dialog) => void dialog.accept());
		await blockBtn.click();
		await expect(page.getByRole("button", { name: "已屏蔽", exact: true })).toBeVisible({
			timeout: 10000,
		});

		// Back on the post, the target's comment is gone; the control's stays.
		await page.goto(`/posts/${postSlug}`);
		await expect(page.locator("main").getByText(controlText)).toBeVisible({
			timeout: 10000,
		});
		await expect(page.locator("main").getByText(targetText)).not.toBeVisible({
			timeout: 10000,
		});

		// The discussion feed also hides the blocked comment.
		await page.goto(`/discussion`);
		await expect(page.locator("main").getByText(controlText)).toBeVisible({
			timeout: 10000,
		});
		await expect(page.locator("main").getByText(targetText)).not.toBeVisible({
			timeout: 10000,
		});

		// Comment search hides the blocked hit too (both comments share the
		// run-unique uid, so the search returns both; after the block, only the
		// control's hit survives). The block list loads async, so the target
		// hit may briefly paint before being filtered — the negative assertion
		// polls until it is gone.
		await page.goto(`/search?q=${uid}&type=comments`);
		await expect(page.locator("main").getByText(controlText)).toBeVisible({
			timeout: 10000,
		});
		await expect(page.locator("main").getByText(targetText)).not.toBeVisible({
			timeout: 10000,
		});
	});
});
