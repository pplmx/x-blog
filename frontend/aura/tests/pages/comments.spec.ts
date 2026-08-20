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
import type { MyComment, MyCommentListResponse } from "../../composables/useApi";

// Fixtures referenced by the deferred (test-time) page import, so the mock
// factories below can close over module-level state without a TDZ error. The
// page module is imported dynamically inside each test (same pattern as
// usePushSubscription.spec.ts) to dodge vi.mock/Vite hoisting.
const isAuthenticated = ref(false);
const mockData = ref<MyCommentListResponse | null>(null);
const mockDeleteMyComment = vi.fn();
const mockFetchMyComments = vi.fn();

vi.mock("../../composables/useReaderAuth", () => ({
	useReaderAuth: () => ({ isAuthenticated }),
}));

vi.mock("../../composables/useSeo", () => ({
	useSeo: vi.fn(),
}));

vi.mock("../../composables/useApi", async (importOriginal) => {
	const orig = await importOriginal<typeof import("../../composables/useApi")>();
	return {
		...orig,
		fetchMyComments: mockFetchMyComments,
		deleteMyComment: mockDeleteMyComment,
	};
});

// fetchMyComments resolves to the response value ($fetch-style); referenced
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
	// The page's setup awaits fetchMyComments (async setup) — flush before
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

	it("shows the empty state when the reader has no comments", async () => {
		isAuthenticated.value = true;
		mockData.value = { items: [], total: 0 };
		const wrapper = await mountPage();
		expect(wrapper.text()).toContain("还没有发表过评论");
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
		await wrapper.get("button").trigger("click");
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
		await wrapper.get("button").trigger("click");

		expect(mockDeleteMyComment).not.toHaveBeenCalled();
		vi.unstubAllGlobals();
	});

	it("surfaces a failure message when delete fails", async () => {
		isAuthenticated.value = true;
		mockData.value = { items: [makeComment()], total: 1 };
		mockDeleteMyComment.mockRejectedValue(new Error("nope"));
		vi.stubGlobal("confirm", () => true);

		const wrapper = await mountPage();
		await wrapper.get("button").trigger("click");
		await wrapper.vm.$nextTick();

		expect(wrapper.text()).toContain("删除失败");
		vi.unstubAllGlobals();
	});
});
