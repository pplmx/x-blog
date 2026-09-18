/**
 * Reader-block journey (round 379, DEC-425).
 *
 * The harassment-control cousin of the follow journey: a signed-in reader
 * blocks another commenter straight from their public profile (/readers/{id})
 * — the block is one-way and invisible (the blocked reader is never told) —
 * and the blocked commenter's @-mentions stop landing in the blocker's inbox
 * at the fan-out point, while a never-blocked control reader still receives
 * the same mention. /account lists the blocked reader for a one-click unblock
 * (no confirmation — restoring is the safe action), and after unblocking the
 * next mention lands again: the opt-out is over exactly when the reader says
 * so, and the blocked reader never hears about any of it.
 */

import { expect, test } from "@playwright/test";

let emailCounter = 0;
function freshEmail(): string {
	emailCounter += 1;
	return `rblk-${Date.now()}-${emailCounter}@example.com`;
}
const PASSWORD = "e2epass123";
const BLOCKER_NAME = "BlockerBee";
const TARGET_NAME = "BlockedBee";
const CONTROL_NAME = "ControlBee";

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

/** Post a comment as `token` (reader) and approve it as the admin. */
async function postAndApproveComment(
	request: import("@playwright/test").APIRequestContext,
	token: string,
	admin: string,
	postId: number,
	content: string,
) {
	const created = await request.post(`/api/comments/post/${postId}`, {
		data: { content, nickname: TARGET_NAME, email: "target@example.com" },
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

/** Whether `token`'s inbox holds a row of the given kind. */
async function inboxHas(
	request: import("@playwright/test").APIRequestContext,
	token: string,
	kind: string,
): Promise<boolean> {
	const resp = await request.get("/api/reader/me/notifications", {
		headers: { Authorization: `Bearer ${token}` },
	});
	expect(resp.status()).toBe(200);
	const body = (await resp.json()) as { items: Array<{ kind: string }> };
	return body.items.some((row) => row.kind === kind);
}

test.describe("Reader block (DEC-425)", () => {
	test("block from the profile → mentions stop, unblock restores them", async ({
		page,
		request,
	}) => {
		const blocker = await registerReader(request, BLOCKER_NAME);
		const target = await registerReader(request, TARGET_NAME);
		const control = await registerReader(request, CONTROL_NAME);
		const admin = await adminToken(request);
		await signIn(page, blocker);

		// The blocker opens the target's public profile and blocks them. The
		// control appears in the same mention but is never blocked.
		await page.goto(`/readers/${target.reader_id}`);
		const blockBtn = page.getByRole("button", { name: "屏蔽" });
		await expect(blockBtn).toBeVisible();
		// Blocking is a safety action: accept the one-time confirm.
		page.once("dialog", (dialog) => void dialog.accept());
		await blockBtn.click();
		await expect(page.getByRole("button", { name: "已屏蔽" })).toBeVisible();

		// The capability: a mention by the blocked reader never lands — while
		// the same mention reaches the unblocked control reader.
		const postId = await firstPostId(request);
		await postAndApproveComment(
			request,
			target.access_token,
			admin,
			postId,
			`cc @${BLOCKER_NAME} and @${CONTROL_NAME} on this`,
		);
		expect(await inboxHas(request, blocker.access_token, "mention")).toBe(false);
		expect(await inboxHas(request, control.access_token, "mention")).toBe(true);

		// The blocker's own account lists the target, and one-click unblock
		// (no confirm — restoring is safe) removes them.
		await page.goto("/account");
		const blocksSection = page.locator("section", { hasText: "已屏蔽的读者" });
		await expect(blocksSection).toBeVisible({ timeout: 10000 });
		await expect(blocksSection.locator("text=" + TARGET_NAME).first()).toBeVisible();
		await blocksSection.getByRole("button", { name: "取消屏蔽" }).click();
		await expect(blocksSection).toContainText("还没有屏蔽任何人");

		// Unblocked: the next mention lands again.
		await postAndApproveComment(
			request,
			target.access_token,
			admin,
			postId,
			`again @${BLOCKER_NAME} now that it's settled`,
		);
		expect(await inboxHas(request, blocker.access_token, "mention")).toBe(true);
	});

	test("blocking one reader does not mute mentions from anyone else", async ({ page, request }) => {
		const blocker2 = await registerReader(request, `${BLOCKER_NAME}2`);
		const target2 = await registerReader(request, `${TARGET_NAME}2`);
		const other = await registerReader(request, "OtherBee");
		const admin = await adminToken(request);
		await signIn(page, blocker2);

		// Block target2 only.
		await page.goto(`/readers/${target2.reader_id}`);
		page.once("dialog", (dialog) => void dialog.accept());
		await page.getByRole("button", { name: "屏蔽" }).click();
		await expect(page.getByRole("button", { name: "已屏蔽" })).toBeVisible();

		// A different, unblocked reader's mention still lands.
		const postId = await firstPostId(request);
		await postAndApproveComment(
			request,
			other.access_token,
			admin,
			postId,
			`hi @${BLOCKER_NAME}2!`,
		);
		expect(await inboxHas(request, blocker2.access_token, "mention")).toBe(true);
	});
});
