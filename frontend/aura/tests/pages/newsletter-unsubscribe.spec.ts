/** Reader /newsletter/unsubscribe page tests (DEC-351, TASK-401). */

import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The page dynamic-imports the API helper; mock it to observe the token call.
const unsubscribeNewsletter = vi.fn();
vi.mock("~~/api/public/newsletter", () => ({ unsubscribeNewsletter }));

vi.mock("~~/composables/useSeo", () => ({ useSeo: vi.fn() }));

let routeQuery: Record<string, unknown> = {};
vi.stubGlobal("useRoute", () => ({ query: routeQuery }));

import NewsletterUnsubscribe from "../../app/pages/newsletter/unsubscribe.vue";

const stubs = {
	Icon: { template: '<svg class="icon-stub" />' },
};

function mountPage(query: Record<string, unknown> = {}) {
	routeQuery = query;
	return mount(NewsletterUnsubscribe, { global: { stubs } });
}

describe("newsletter unsubscribe page", () => {
	beforeEach(() => {
		unsubscribeNewsletter.mockReset();
	});

	it("shows the invalid-link message when no token is present", async () => {
		const wrapper = mountPage({});
		await flushPromises();
		expect(unsubscribeNewsletter).not.toHaveBeenCalled();
		expect(wrapper.text()).toContain("这个退订链接无效，或已经被使用过。");
	});

	it("posts the token once and shows success", async () => {
		unsubscribeNewsletter.mockResolvedValue({ unsubscribed: true });
		const wrapper = mountPage({ token: "tok-123" });
		await flushPromises();

		expect(unsubscribeNewsletter).toHaveBeenCalledTimes(1);
		expect(unsubscribeNewsletter).toHaveBeenCalledWith("tok-123");
		expect(wrapper.text()).toContain("已取消订阅");
	});

	it("shows the invalid state when the token is unknown/used (404)", async () => {
		unsubscribeNewsletter.mockRejectedValue({ response: { status: 404 } });
		const wrapper = mountPage({ token: "tok-404" });
		await flushPromises();

		expect(unsubscribeNewsletter).toHaveBeenCalledTimes(1);
		expect(wrapper.text()).toContain("这个退订链接无效，或已经被使用过。");
	});

	it("shows a network error (not 'invalid link') when the backend is unreachable", async () => {
		unsubscribeNewsletter.mockRejectedValue(
			new Error("FetchError: request to /api/newsletter/unsubscribe failed"),
		);
		const wrapper = mountPage({ token: "tok-net" });
		await flushPromises();

		expect(unsubscribeNewsletter).toHaveBeenCalledTimes(1);
		expect(wrapper.text()).toContain("暂时无法连接服务器");
		// Crucially NOT the "invalid/used" claim — the token may still be live.
		expect(wrapper.text()).not.toContain("这个退订链接无效，或已经被使用过。");
	});
});
