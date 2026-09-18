/** Reader /comment-subscribe/unsubscribe page tests (DEC-427, TASK-438). */

import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The page dynamic-imports the API helper; mock it to observe the token call.
const unsubscribeGuestThreadSubscription = vi.fn();
vi.mock("~~/api/public/comments", () => ({ unsubscribeGuestThreadSubscription }));

vi.mock("~~/composables/useSeo", () => ({ useSeo: vi.fn() }));

let routeQuery: Record<string, unknown> = {};
vi.stubGlobal("useRoute", () => ({ query: routeQuery }));

import UnsubscribePage from "../../app/pages/comment-subscribe/unsubscribe.vue";

const stubs = {
	Icon: { template: '<svg class="icon-stub" />' },
};

function mountPage(query: Record<string, unknown> = {}) {
	routeQuery = query;
	return mount(UnsubscribePage, { global: { stubs } });
}

describe("comment-subscribe unsubscribe page", () => {
	beforeEach(() => {
		unsubscribeGuestThreadSubscription.mockReset();
	});

	it("shows the invalid-link message when no token is present", async () => {
		const wrapper = mountPage({});
		await flushPromises();
		expect(unsubscribeGuestThreadSubscription).not.toHaveBeenCalled();
		expect(wrapper.text()).toContain("这个退订链接无效，或已经被使用过。");
	});

	it("posts the token once and shows success", async () => {
		unsubscribeGuestThreadSubscription.mockResolvedValue({ unsubscribed: true });
		const wrapper = mountPage({ token: "tok-123" });
		await flushPromises();

		expect(unsubscribeGuestThreadSubscription).toHaveBeenCalledTimes(1);
		expect(unsubscribeGuestThreadSubscription).toHaveBeenCalledWith("tok-123");
		expect(wrapper.text()).toContain("这篇讨论以后有新评论时，你将不再收到邮件。");
	});

	it("shows the invalid state when the token is unknown/used (404)", async () => {
		unsubscribeGuestThreadSubscription.mockRejectedValue({
			response: { status: 404 },
		});
		const wrapper = mountPage({ token: "tok-404" });
		await flushPromises();

		expect(unsubscribeGuestThreadSubscription).toHaveBeenCalledTimes(1);
		expect(wrapper.text()).toContain("这个退订链接无效，或已经被使用过。");
	});

	it("shows a network error (not 'invalid link') when the backend is unreachable", async () => {
		unsubscribeGuestThreadSubscription.mockRejectedValue(
			new Error("FetchError: request to /api/posts/comment-subscription/guest/unsubscribe failed"),
		);
		const wrapper = mountPage({ token: "tok-net" });
		await flushPromises();

		expect(unsubscribeGuestThreadSubscription).toHaveBeenCalledTimes(1);
		expect(wrapper.text()).toContain("网络错误，请稍后重试。");
		// Crucially NOT the "invalid/used" claim — the token may still be live.
		expect(wrapper.text()).not.toContain("这个退订链接无效，或已经被使用过。");
	});
});
