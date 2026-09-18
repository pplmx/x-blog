/** Reader /comment-manage page tests (round 385, DEC-435/TASK-444). */

import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";

// The page dynamic-imports the API helpers; mock them to observe the calls.
const getGuestCommentManage = vi.fn();
const editGuestCommentManage = vi.fn();
const deleteGuestCommentManage = vi.fn();
vi.mock("~~/api/public/comments", () => ({
	getGuestCommentManage,
	editGuestCommentManage,
	deleteGuestCommentManage,
}));

vi.mock("~~/composables/useSeo", () => ({ useSeo: vi.fn() }));

let routeQuery: Record<string, unknown> = {};
vi.stubGlobal("useRoute", () => ({ query: routeQuery }));

let confirmImpl: () => boolean = () => true;
vi.stubGlobal("confirm", () => confirmImpl());

import CommentManage from "../../app/pages/comment-manage.vue";

const stubs = {
	Icon: { template: '<svg class="icon-stub" />' },
	NuxtLink: { template: "<a><slot /></a>" },
};

function mountPage(query: Record<string, unknown> = {}) {
	routeQuery = query;
	return mount(CommentManage, { global: { stubs } });
}

const EXAMPLE_COMMENT = {
	id: 7,
	post_id: 3,
	parent_id: null,
	nickname: "游客",
	content: "编辑前的评论",
	is_approved: false,
	likes: 0,
	created_at: "2026-09-18T10:00:00Z",
	editor: null,
	reader: null,
};

/** Trigger the on-page button whose label contains ``text``. */
async function clickButton(wrapper: ReturnType<typeof mountPage>, text: string): Promise<void> {
	const button = wrapper.findAll("button").find((b) => b.text().includes(text));
	await button?.trigger("click");
}

describe("comment-manage page", () => {
	beforeEach(() => {
		getGuestCommentManage.mockReset();
		editGuestCommentManage.mockReset();
		deleteGuestCommentManage.mockReset();
		confirmImpl = () => true;
	});

	it("shows the invalid-link message when no token is present", async () => {
		const wrapper = mountPage({});
		await flushPromises();
		expect(getGuestCommentManage).not.toHaveBeenCalled();
		expect(wrapper.text()).toContain("这个链接无效，或已经被使用过。");
	});

	it("loads the comment with the token and renders its content + status", async () => {
		getGuestCommentManage.mockResolvedValue({
			comment: EXAMPLE_COMMENT,
			post: { id: 3, title: "测试文章", slug: "test-post" },
		});
		const wrapper = mountPage({ token: "tok-1" });
		await flushPromises();

		expect(getGuestCommentManage).toHaveBeenCalledTimes(1);
		expect(getGuestCommentManage).toHaveBeenCalledWith("tok-1");
		expect((wrapper.find("textarea").element as HTMLTextAreaElement).value).toBe("编辑前的评论");
		expect(wrapper.text()).toContain("测试文章");
		// Pending (is_approved=false) shows the moderation badge.
		expect(wrapper.text()).toContain("待审核");
	});

	it("shows the invalid state when the token is unknown (404)", async () => {
		getGuestCommentManage.mockRejectedValue({ response: { status: 404 } });
		const wrapper = mountPage({ token: "tok-404" });
		await flushPromises();

		expect(wrapper.text()).toContain("这个链接无效，或已经被使用过。");
	});

	it("shows a network error (not 'invalid link') when the backend is unreachable", async () => {
		getGuestCommentManage.mockRejectedValue(new Error("no response"));
		const wrapper = mountPage({ token: "tok-net" });
		await flushPromises();

		expect(wrapper.text()).toContain("网络错误，请稍后重试。");
		expect(wrapper.text()).not.toContain("这个链接无效，或已经被使用过。");
	});

	it("edits the comment text via the token and flashes saved", async () => {
		getGuestCommentManage.mockResolvedValue({
			comment: EXAMPLE_COMMENT,
			post: { id: 3, title: "测试文章", slug: "test-post" },
		});
		editGuestCommentManage.mockResolvedValue({
			...EXAMPLE_COMMENT,
			content: "改后的评论",
			is_approved: false,
		});
		const wrapper = mountPage({ token: "tok-2" });
		await flushPromises();

		await wrapper.find("textarea").setValue("改后的评论");
		await clickButton(wrapper, "保存");
		await flushPromises();

		expect(editGuestCommentManage).toHaveBeenCalledTimes(1);
		expect(editGuestCommentManage).toHaveBeenCalledWith("tok-2", "改后的评论");
		expect(wrapper.text()).toContain("已保存");
	});

	it("deletes the comment after confirm and shows the deleted state", async () => {
		getGuestCommentManage.mockResolvedValue({
			comment: EXAMPLE_COMMENT,
			post: { id: 3, title: "测试文章", slug: "test-post" },
		});
		deleteGuestCommentManage.mockResolvedValue(undefined);
		const wrapper = mountPage({ token: "tok-3" });
		await flushPromises();

		await clickButton(wrapper, "删除");
		await flushPromises();

		expect(deleteGuestCommentManage).toHaveBeenCalledTimes(1);
		expect(deleteGuestCommentManage).toHaveBeenCalledWith("tok-3");
		expect(wrapper.text()).toContain("评论已删除");
	});

	it("does not delete when the confirm is cancelled", async () => {
		confirmImpl = () => false;
		getGuestCommentManage.mockResolvedValue({
			comment: EXAMPLE_COMMENT,
			post: { id: 3, title: "测试文章", slug: "test-post" },
		});
		const wrapper = mountPage({ token: "tok-4" });
		await flushPromises();

		await clickButton(wrapper, "删除");
		await flushPromises();

		expect(deleteGuestCommentManage).not.toHaveBeenCalled();
		expect((wrapper.find("textarea").element as HTMLTextAreaElement).value).toBe("编辑前的评论");
	});
});
