/** Reader /comment-subscribe/confirm page tests (DEC-427, TASK-438). */

import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The page dynamic-imports the API helper; mock it to observe the token call.
const confirmGuestThreadSubscription = vi.fn();
vi.mock("~~/api/public/comments", () => ({ confirmGuestThreadSubscription }));

vi.mock("~~/composables/useSeo", () => ({ useSeo: vi.fn() }));

let routeQuery: Record<string, unknown> = {};
vi.stubGlobal("useRoute", () => ({ query: routeQuery }));

import ConfirmPage from "../../app/pages/comment-subscribe/confirm.vue";

const stubs = {
	Icon: { template: '<svg class="icon-stub" />' },
};

function mountPage(query: Record<string, unknown> = {}) {
	routeQuery = query;
	return mount(ConfirmPage, { global: { stubs } });
}

describe("comment-subscribe confirm page", () => {
	beforeEach(() => {
		confirmGuestThreadSubscription.mockReset();
	});

	it("shows the invalid-link message when no token is present", async () => {
		const wrapper = mountPage({});
		await flushPromises();
		expect(confirmGuestThreadSubscription).not.toHaveBeenCalled();
		expect(wrapper.text()).toContain("这个确认链接无效，或已经被使用过。");
	});

	it("posts the token once and shows success", async () => {
		confirmGuestThreadSubscription.mockResolvedValue({ confirmed: true });
		const wrapper = mountPage({ token: "tok-123" });
		await flushPromises();

		expect(confirmGuestThreadSubscription).toHaveBeenCalledTimes(1);
		expect(confirmGuestThreadSubscription).toHaveBeenCalledWith("tok-123");
		expect(wrapper.text()).toContain("这篇讨论每当有新评论通过审核时，你都会收到一封邮件。");
	});

	it("shows the invalid state when the token is unknown/used (404)", async () => {
		confirmGuestThreadSubscription.mockRejectedValue({
			response: { status: 404 },
		});
		const wrapper = mountPage({ token: "tok-404" });
		await flushPromises();

		expect(confirmGuestThreadSubscription).toHaveBeenCalledTimes(1);
		expect(wrapper.text()).toContain("这个确认链接无效，或已经被使用过。");
	});

	it("shows a network error (not 'invalid link') when the backend is unreachable", async () => {
		confirmGuestThreadSubscription.mockRejectedValue(
			new Error("FetchError: request to /api/posts/comment-subscription/guest/confirm failed"),
		);
		const wrapper = mountPage({ token: "tok-net" });
		await flushPromises();

		expect(confirmGuestThreadSubscription).toHaveBeenCalledTimes(1);
		expect(wrapper.text()).toContain("网络错误，请稍后重试。");
		// Crucially NOT the "invalid/used" claim — the token may still be live.
		expect(wrapper.text()).not.toContain("这个确认链接无效，或已经被使用过。");
	});
});
