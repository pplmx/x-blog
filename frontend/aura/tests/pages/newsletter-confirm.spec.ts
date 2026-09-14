/** Reader /newsletter/confirm page tests (DEC-351, TASK-401). */

import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The page dynamic-imports the API helper; mock it to observe the token call.
const confirmNewsletter = vi.fn();
vi.mock("~~/api/public/newsletter", () => ({ confirmNewsletter }));

vi.mock("~~/composables/useSeo", () => ({ useSeo: vi.fn() }));

let routeQuery: Record<string, unknown> = {};
vi.stubGlobal("useRoute", () => ({ query: routeQuery }));

import NewsletterConfirm from "../../app/pages/newsletter/confirm.vue";

const stubs = {
	Icon: { template: '<svg class="icon-stub" />' },
};

function mountPage(query: Record<string, unknown> = {}) {
	routeQuery = query;
	return mount(NewsletterConfirm, { global: { stubs } });
}

describe("newsletter confirm page", () => {
	beforeEach(() => {
		confirmNewsletter.mockReset();
	});

	it("shows the invalid-link message when no token is present", async () => {
		const wrapper = mountPage({});
		await flushPromises();
		expect(confirmNewsletter).not.toHaveBeenCalled();
		expect(wrapper.text()).toContain("这个确认链接无效，或已经被使用过。");
	});

	it("posts the token once and shows success", async () => {
		confirmNewsletter.mockResolvedValue({ confirmed: true });
		const wrapper = mountPage({ token: "tok-123" });
		await flushPromises();

		expect(confirmNewsletter).toHaveBeenCalledTimes(1);
		expect(confirmNewsletter).toHaveBeenCalledWith("tok-123");
		expect(wrapper.text()).toContain("订阅成功！");
	});

	it("shows the invalid state when the token is unknown/used (404)", async () => {
		confirmNewsletter.mockRejectedValue({ response: { status: 404 } });
		const wrapper = mountPage({ token: "tok-404" });
		await flushPromises();

		expect(confirmNewsletter).toHaveBeenCalledTimes(1);
		expect(wrapper.text()).toContain("这个确认链接无效，或已经被使用过。");
	});

	it("shows a network error (not 'invalid link') when the backend is unreachable", async () => {
		confirmNewsletter.mockRejectedValue(
			new Error("FetchError: request to /api/newsletter/confirm failed"),
		);
		const wrapper = mountPage({ token: "tok-net" });
		await flushPromises();

		expect(confirmNewsletter).toHaveBeenCalledTimes(1);
		expect(wrapper.text()).toContain("暂时无法连接服务器");
		// Crucially NOT the "invalid/used" claim — the token may still be live.
		expect(wrapper.text()).not.toContain("这个确认链接无效，或已经被使用过。");
	});
});
