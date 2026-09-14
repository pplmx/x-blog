/** Reader /comment-reply-unsubscribe page tests (DEC-332, TASK-392). */

import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";

// The page dynamic-imports the API helper; mock it to observe the token call.
const unsubscribeGuestReplyNotify = vi.fn();
vi.mock("~~/api/public/comments", () => ({ unsubscribeGuestReplyNotify }));

vi.mock("~~/composables/useSeo", () => ({ useSeo: vi.fn() }));

let routeQuery: Record<string, unknown> = {};
vi.stubGlobal("useRoute", () => ({ query: routeQuery }));

import ReplyUnsubscribe from "../../app/pages/comment-reply-unsubscribe.vue";

const stubs = {
	Icon: { template: '<svg class="icon-stub" />' },
};

function mountPage(query: Record<string, unknown> = {}) {
	routeQuery = query;
	return mount(ReplyUnsubscribe, { global: { stubs } });
}

describe("reply-unsubscribe page", () => {
	beforeEach(() => {
		unsubscribeGuestReplyNotify.mockReset();
	});

	it("shows the invalid-link message when no token is present", async () => {
		const wrapper = mountPage({});
		await flushPromises();
		expect(unsubscribeGuestReplyNotify).not.toHaveBeenCalled();
		expect(wrapper.text()).toContain("这个退订链接无效，或已经被使用过。");
	});

	it("posts the token once and shows success", async () => {
		unsubscribeGuestReplyNotify.mockResolvedValue({ unsubscribed: true });
		const wrapper = mountPage({ token: "tok-123" });
		await flushPromises();

		expect(unsubscribeGuestReplyNotify).toHaveBeenCalledTimes(1);
		expect(unsubscribeGuestReplyNotify).toHaveBeenCalledWith("tok-123");
		expect(wrapper.text()).toContain("你以后将不再收到该评论有新回复时的邮件通知。");
	});

	it("shows the invalid state when the token is unknown/used (404)", async () => {
		unsubscribeGuestReplyNotify.mockRejectedValue({
			response: { status: 404 },
		});
		const wrapper = mountPage({ token: "tok-404" });
		await flushPromises();

		expect(unsubscribeGuestReplyNotify).toHaveBeenCalledTimes(1);
		expect(wrapper.text()).toContain("这个退订链接无效，或已经被使用过。");
	});

	it("shows a network error (not 'invalid link') when the backend is unreachable", async () => {
		unsubscribeGuestReplyNotify.mockRejectedValue(
			new Error("FetchError: request to /api/comments/reply-notify/unsubscribe failed"),
		);
		const wrapper = mountPage({ token: "tok-net" });
		await flushPromises();

		expect(unsubscribeGuestReplyNotify).toHaveBeenCalledTimes(1);
		expect(wrapper.text()).toContain("网络错误，请稍后重试。");
		// Crucially NOT the "invalid/used" claim — the token may still be live.
		expect(wrapper.text()).not.toContain("这个退订链接无效，或已经被使用过。");
	});
});
