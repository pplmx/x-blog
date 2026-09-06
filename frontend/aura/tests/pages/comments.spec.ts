/**
 * "My comments" page tests (DEC-066, TASK-140).
 *
 * Reader-scoped comment history: logged-out visitors see a sign-in prompt; a
 * signed-in reader sees their comments with moderation-status badges
 * (pending / approved / rejected), a link back to the thread, and a delete
 * action that calls deleteMyComment then refreshes the list.
 */

import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import type { MyComment, MyCommentListResponse } from "../../api/reader/comments";

// Fixtures referenced by the deferred (test-time) page import, so the mock
// factories below can close over module-level state without a TDZ error. The
// page module is imported dynamically inside each test (same pattern as
// usePushSubscription.spec.ts) to dodge vi.mock/Vite hoisting.
const isAuthenticated = ref(false);
const mockData = ref<MyCommentListResponse | null>(null);
const mockDeleteMyComment = vi.fn();
const mockFetchMyComments = vi.fn();

// Faithful copy of useReaderAuth.isStaleSession (this page has no
// business-level wrong-password 401, so a bare 401 is always a dead session).
const isStaleSession = vi.fn(
	(cause: unknown) =>
		(cause as { statusCode?: number } | undefined)?.statusCode === 401 ||
		(cause as { response?: { status?: number } } | undefined)?.response?.status === 401,
);
// Flips isAuthenticated like the real logout, so a routed stale session leaves
// the inbox and shows the sign-in prompt instead of a dead-looking state.
const mockLogout = vi.fn(() => {
	isAuthenticated.value = false;
});

vi.mock("../../composables/useReaderAuth", () => ({
	useReaderAuth: () => ({ isAuthenticated, logout: mockLogout, isStaleSession }),
}));

vi.mock("../../composables/useSeo", () => ({
	useSeo: vi.fn(),
}));

vi.mock("../../api/reader/comments", () => ({
	getMyComments: mockFetchMyComments,
	deleteMyComment: mockDeleteMyComment,
}));

// getMyComments resolves to the response value ($fetch-style); referenced
// only after the page module is dynamically imported (no hoisting TDZ).
mockFetchMyComments.mockImplementation(() =>
	Promise.resolve(mockData.value as MyCommentListResponse),
);

const stubs = {
	Icon: {
		template: '<svg class="icon-stub" />',
	},
	NuxtLink: {
		template: '<a class="nuxt-link-stub"><slot/></a>',
	},
};

// Lazy: the selected page module is not named at import time.
let MyComments: Awaited<ReturnType<typeof importPage>>;

async function importPage() {
	return (await import("../../app/pages/comments.vue")).default;
}

async function mountPage() {
	MyComments = MyComments ?? (await importPage());
	const wrapper = mount(MyComments, {
		global: { stubs },
	});
	// The page's setup awaits getMyComments (async setup) — flush before
	// asserting so the slots below actually render.
	await flushPromises();
	return wrapper;
}

function makeComment(overrides: Partial<MyComment> = {}): MyComment {
	return {
		id: 1,
		post_id: 1,
		parent_id: null,
		nickname: "Reader",
		content: "A comment",
		is_approved: false,
		created_at: "2024-01-15T10:00:00Z",
		reader: { id: 1, display_name: "Reader" },
		status: "pending",
		post: { id: 1, title: "Test Post", slug: "test-post" },
		...overrides,
	};
}

afterEach(() => {
	vi.clearAllMocks();
	isAuthenticated.value = false;
	mockData.value = null;
});

describe("My comments page", () => {
	it("renders the page title", async () => {
		isAuthenticated.value = true;
		mockData.value = { items: [], total: 0 };
		const wrapper = await mountPage();
		expect(wrapper.text()).toContain("我的评论");
	});

	it("shows a sign-in prompt when logged out", async () => {
		isAuthenticated.value = false;
		const wrapper = await mountPage();
		expect(wrapper.text()).toContain("登录后可以查看和管理你的评论");
	});

	it("does not fire an authenticated fetch (or a redirect) for a guest (ISS-383)", async () => {
		// Guests see the in-page sign-in prompt; the old code called getMyComments
		// on mount, whose 401 raced the prompt into logout()+navigateTo('/login') —
		// stealing the reader's intended post-login landing. The guard must keep
		// the prompt in place without the redirect (mirror notifications/account).
		isAuthenticated.value = false;
		const navigateTo = vi.fn();
		vi.stubGlobal("navigateTo", navigateTo);

		await mountPage();

		expect(mockFetchMyComments).not.toHaveBeenCalled();
		expect(mockLogout).not.toHaveBeenCalled();
		expect(navigateTo).not.toHaveBeenCalled();
		expect(navigateTo).not.toHaveBeenCalledWith("/login");
		vi.unstubAllGlobals();
	});

	it("shows the empty state when the reader has no comments", async () => {
		isAuthenticated.value = true;
		mockData.value = { items: [], total: 0 };
		const wrapper = await mountPage();
		expect(wrapper.text()).toContain("还没有发表过评论");
	});

	it("shows a distinct error state (not the empty list) when the fetch fails (ISS-129)", async () => {
		isAuthenticated.value = true;
		mockFetchMyComments.mockRejectedValueOnce(new Error("network"));
		const wrapper = await mountPage();
		expect(wrapper.text()).toContain("网络错误，请稍后重试");
		expect(wrapper.text()).not.toContain("还没有发表过评论");
		// Retry is offered and recovers the list.
		mockData.value = { items: [makeComment()], total: 1 };
		const retry = wrapper.findAll("button").find((b) => b.text().includes("重试"));
		expect(retry).toBeDefined();
		await retry?.trigger("click");
		await flushPromises();
		expect(wrapper.text()).toContain("共 1 条评论");
	});

	it("shows the comment count", async () => {
		isAuthenticated.value = true;
		mockData.value = { items: [makeComment()], total: 1 };
		const wrapper = await mountPage();
		expect(wrapper.text()).toContain("共 1 条评论");
	});

	it("shows a pending status badge with the moderation copy", async () => {
		isAuthenticated.value = true;
		mockData.value = { items: [makeComment()], total: 1 };
		const wrapper = await mountPage();
		expect(wrapper.text()).toContain("待审核");
		expect(wrapper.text()).toContain("A comment");
		expect(wrapper.text()).toContain("评论于《Test Post》");
	});

	it("shows approved and rejected badges for the other statuses", async () => {
		isAuthenticated.value = true;
		mockData.value = {
			items: [
				makeComment({ id: 1, status: "approved", is_approved: true }),
				makeComment({ id: 2, status: "rejected" }),
			],
			total: 2,
		};
		const wrapper = await mountPage();
		expect(wrapper.text()).toContain("已发布");
		expect(wrapper.text()).toContain("未通过");
	});

	it("deletes a comment after confirmation and reloads the list", async () => {
		isAuthenticated.value = true;
		mockData.value = { items: [makeComment()], total: 1 };
		mockDeleteMyComment.mockResolvedValue(undefined);
		vi.stubGlobal("confirm", () => true);

		const wrapper = await mountPage();
		expect(mockFetchMyComments).toHaveBeenCalledTimes(1); // initial load
		const deleteBtn = wrapper.findAll("button").find((b) => b.text().includes("删除"));
		expect(deleteBtn).toBeDefined();
		await deleteBtn?.trigger("click");
		await flushPromises();

		expect(mockDeleteMyComment).toHaveBeenCalledWith(1);
		expect(mockFetchMyComments).toHaveBeenCalledTimes(2); // reloaded after delete
		vi.unstubAllGlobals();
	});

	it("does not delete when the confirmation is dismissed", async () => {
		isAuthenticated.value = true;
		mockData.value = { items: [makeComment()], total: 1 };
		vi.stubGlobal("confirm", () => false);

		const wrapper = await mountPage();
		const deleteBtn = wrapper.findAll("button").find((b) => b.text().includes("删除"));
		expect(deleteBtn).toBeDefined();
		await deleteBtn?.trigger("click");

		expect(mockDeleteMyComment).not.toHaveBeenCalled();
		vi.unstubAllGlobals();
	});

	it("surfaces a failure message when delete fails", async () => {
		isAuthenticated.value = true;
		mockData.value = { items: [makeComment()], total: 1 };
		mockDeleteMyComment.mockRejectedValue(new Error("nope"));
		vi.stubGlobal("confirm", () => true);

		const wrapper = await mountPage();
		const deleteBtn = wrapper.findAll("button").find((b) => b.text().includes("删除"));
		expect(deleteBtn).toBeDefined();
		await deleteBtn?.trigger("click");
		await wrapper.vm.$nextTick();

		expect(wrapper.text()).toContain("删除失败");
		vi.unstubAllGlobals();
	});

	it("routes an expired session to /login instead of a misleading network error (ISS-110)", async () => {
		// A dead reader token 401s with no recoverable meaning; the old path
		// showed a "网络错误 + retry" that could never succeed while the page
		// still looked signed-in. Now it logs out and sends the reader to sign-in,
		// matching account.vue / notifications.vue.
		isAuthenticated.value = true;
		const navigateTo = vi.fn();
		vi.stubGlobal("navigateTo", navigateTo);
		mockFetchMyComments.mockRejectedValueOnce({ statusCode: 401 });

		const wrapper = await mountPage();

		expect(mockLogout).toHaveBeenCalledTimes(1);
		expect(navigateTo).toHaveBeenCalledWith("/login");
		// A failed load must NOT present as a network error the reader can never
		// outgrow; the inbox is auth-scoped, so only the sign-in prompt remains.
		expect(wrapper.text()).not.toContain("网络错误，请稍后重试");
		expect(wrapper.text()).toContain("登录后可以查看和管理你的评论");
		vi.unstubAllGlobals();
	});

	it("routes an expired session to /login when a delete hits a 401 (deep-dive)", async () => {
		isAuthenticated.value = true;
		mockData.value = { items: [makeComment()], total: 1 };
		const navigateTo = vi.fn();
		vi.stubGlobal("navigateTo", navigateTo);
		mockDeleteMyComment.mockRejectedValue({ statusCode: 401 });
		vi.stubGlobal("confirm", () => true);

		const wrapper = await mountPage();
		const deleteBtn = wrapper.findAll("button").find((b) => b.text().includes("删除"));
		await deleteBtn?.trigger("click");
		await flushPromises();

		expect(mockLogout).toHaveBeenCalledTimes(1);
		expect(navigateTo).toHaveBeenCalledWith("/login");
		// No misleading "删除失败" for a dead session — the reader is redirected.
		expect(wrapper.text()).not.toContain("删除失败");
		vi.unstubAllGlobals();
	});

	it("disables the row's delete button while its delete is in flight (deep-dive)", async () => {
		// Two rapid deletes on different rows previously shared one `deleting`
		// slot — the second row's finally re-enabled the first row's button
		// mid-request. Each row tracks its own in-flight marker now.
		isAuthenticated.value = true;
		mockData.value = { items: [makeComment(), makeComment({ id: 2 })], total: 2 };
		let resolveDelete!: (v: unknown) => void;
		mockDeleteMyComment.mockImplementation(
			() =>
				new Promise((resolve) => {
					resolveDelete = resolve;
				}),
		);
		vi.stubGlobal("confirm", () => true);

		const wrapper = await mountPage();
		const deleteBtns = wrapper.findAll("button").filter((b) => b.text().includes("删除"));
		await deleteBtns[0].trigger("click");
		await flushPromises();
		expect((deleteBtns[0].element as HTMLButtonElement).disabled).toBe(true);
		expect(deleteBtns[0].attributes("aria-busy")).toBe("true");
		// A different row's delete may still be clicked while row 1 is pending.
		expect((deleteBtns[1].element as HTMLButtonElement).disabled).toBe(false);

		resolveDelete(undefined);
		await flushPromises();
		// After the reload both rows' deletes are enabled again.
		const after = wrapper.findAll("button").filter((b) => b.text().includes("删除"));
		expect(after.every((b) => !(b.element as HTMLButtonElement).disabled)).toBe(true);
		vi.unstubAllGlobals();
	});

	describe("filter + pagination (DEC-102, TASK-163)", () => {
		it("renders the four status filter buttons", async () => {
			isAuthenticated.value = true;
			mockData.value = { items: [makeComment()], total: 1 };
			const wrapper = await mountPage();
			// The four filters use aria-pressed (mutually exclusive buttons), not
			// a fake role="tab" that would imply unsupported arrow-key navigation.
			const tabs = wrapper.findAll("[aria-pressed]");
			expect(tabs.map((t) => t.text())).toEqual(["全部", "待审核", "已通过", "未通过"]);
		});

		it("re-fetches with the selected status and resets to page 1", async () => {
			isAuthenticated.value = true;
			mockData.value = { items: [makeComment()], total: 1 };
			mockFetchMyComments.mockClear();
			const wrapper = await mountPage();
			// Value "approved" maps to the "已通过" tab (third), via setStatus.
			const tabs = wrapper.findAll("[aria-pressed]");
			expect(mockFetchMyComments).toHaveBeenLastCalledWith("all", 1, 20);
			await tabs[2].trigger("click");
			await flushPromises();
			expect(mockFetchMyComments).toHaveBeenLastCalledWith("approved", 1, 20);
		});

		it("renders pagination and navigates pages when total_pages > 1", async () => {
			isAuthenticated.value = true;
			mockData.value = {
				items: Array.from({ length: 2 }, (_, i) => makeComment({ id: i + 1 })),
				total: 3,
				page: 1,
				limit: 2,
				total_pages: 2,
			};
			mockFetchMyComments.mockClear();
			const wrapper = await mountPage();
			await flushPromises();

			const nav = wrapper.find("nav");
			expect(nav.exists()).toBe(true);
			// navigate to page 2
			await nav.findAll("button")[1].trigger("click");
			await flushPromises();
			expect(mockFetchMyComments).toHaveBeenLastCalledWith("all", 2, 20);
		});

		it("does not render pagination when there is a single page", async () => {
			isAuthenticated.value = true;
			mockData.value = { items: [makeComment()], total: 1, total_pages: 1 };
			const wrapper = await mountPage();
			expect(wrapper.find("nav").exists()).toBe(false);
		});

		it("offers first/last + ellipsis far-page navigation on deep history (round 265)", async () => {
			// Regression (survey #4): the previous hand-rolled 5-window showed
			// only pages 3..7 around page 5 on a 10-page history — no path to the
			// far pages. The shared paginationPages tokens now include page 1,
			// page 10 and an ellipsis so the first/last pages are one click away.
			isAuthenticated.value = true;
			mockData.value = {
				items: [],
				total: 200,
				page: 5,
				limit: 20,
				total_pages: 10,
			};
			mockFetchMyComments.mockClear();
			const wrapper = await mountPage();
			await flushPromises();

			const buttons = wrapper.findAll("nav button");
			const labels = buttons.map((b) => b.text());
			expect(labels[0]).toBe("1");
			expect(labels).toContain("5");
			expect(labels[labels.length - 1]).toBe("10");
			expect(labels).toContain("…");
			// The ellipsis is a non-clickable spacer, not a page link.
			const ellipsis = buttons.find((b) => b.text() === "…");
			expect(ellipsis?.attributes("disabled")).toBeDefined();

			// Clicking the far last page navigates there.
			await buttons[buttons.length - 1].trigger("click");
			await flushPromises();
			expect(mockFetchMyComments).toHaveBeenLastCalledWith("all", 10, 20);
		});

		it("clamps back to the last valid page after deleting the only comment on it (deep-dive)", async () => {
			// Reader is on page 2 (the last page). After deleting its only
			// comment, the reload sees an empty page under a non-zero total —
			// this must clamp currentPage back to the last valid page and re-fetch
			// instead of rendering a fake "you haven't commented yet" under a
			// stale count.
			isAuthenticated.value = true;
			const page1 = {
				items: [makeComment()],
				total: 2,
				page: 1,
				limit: 20,
				total_pages: 2,
			};
			const page2 = {
				items: [makeComment({ id: 2, content: "Second comment" })],
				total: 2,
				page: 2,
				limit: 20,
				total_pages: 2,
			};
			mockFetchMyComments.mockImplementation((_status: string, page: number) =>
				Promise.resolve(page === 2 ? page2 : page1),
			);
			mockDeleteMyComment.mockResolvedValue(undefined);
			vi.stubGlobal("confirm", () => true);

			const wrapper = await mountPage(); // initial load → page 1
			const nav = wrapper.find("nav");
			expect(nav.exists()).toBe(true);
			await nav.findAll("button")[1].trigger("click"); // go to page 2
			await flushPromises();
			expect(wrapper.text()).toContain("Second comment");

			// Now the reload after delete returns the drained page 2 (empty items
			// but total still > 0 because page 1 holds comments); the clamp's
			// recursive refetch of page 1 must see the still-populated page 1.
			mockFetchMyComments.mockImplementation((_status: string, page: number) =>
				Promise.resolve(
					page === 2
						? { items: [], total: 1, page: 2, limit: 20, total_pages: 1 }
						: { ...page1, items: page1.items.slice(0, 1), total: 1 },
				),
			);
			const deleteBtn = wrapper.findAll("button").find((b) => b.text().includes("删除"));
			expect(deleteBtn).toBeDefined();
			await deleteBtn?.trigger("click");
			await flushPromises();

			// Clamped to page 1 and re-fetched: the drained page 2 was visited,
			// then the clamp's re-fetch landed back on the populated page 1.
			expect(mockFetchMyComments).toHaveBeenLastCalledWith("all", 1, 20);
			expect(wrapper.text()).toContain("A comment");
			expect(wrapper.text()).not.toContain("还没有发表过评论");
			vi.unstubAllGlobals();
		});
	});
});
