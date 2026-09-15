/** Reader /email-change page tests (DEC-357, TASK-404). */

import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The page calls useReaderAuth().confirmEmailChange() (dynamic-imported API
// behind it) on mount with the ?token= link.
const confirmEmailChange = vi.fn();
vi.mock("~~/composables/useReaderAuth", () => ({
	useReaderAuth: () => ({ confirmEmailChange }),
}));

vi.mock("~~/composables/useSeo", () => ({ useSeo: vi.fn() }));

let routeQuery: Record<string, unknown> = {};
vi.stubGlobal("useRoute", () => ({ query: routeQuery }));

import EmailChange from "../../app/pages/email-change.vue";

const stubs = {
	Icon: { template: '<svg class="icon-stub" />' },
	NuxtLink: { template: '<a class="nuxt-link-stub"><slot /></a>' },
};

const navigateTo = vi.fn().mockResolvedValue(undefined);
vi.stubGlobal("navigateTo", navigateTo);

function mountPage(query: Record<string, unknown> = {}) {
	routeQuery = query;
	return mount(EmailChange, { global: { stubs } });
}

describe("email-change page", () => {
	beforeEach(() => {
		confirmEmailChange.mockReset();
		navigateTo.mockClear();
	});

	it("shows the invalid-link message when no token is present", async () => {
		const wrapper = mountPage({});
		await flushPromises();
		expect(confirmEmailChange).not.toHaveBeenCalled();
		expect(wrapper.text()).toContain("此链接无效或已过期");
		expect(navigateTo).not.toHaveBeenCalled();
	});

	it("redeems the token once and routes to the account page", async () => {
		confirmEmailChange.mockResolvedValue({
			access_token: "fresh.jwt",
			token_type: "bearer",
			reader: { id: 1, email: "new@example.com" },
		});
		const wrapper = mountPage({ token: "abcd.efgh.ijkl" });
		await flushPromises();

		expect(confirmEmailChange).toHaveBeenCalledTimes(1);
		expect(confirmEmailChange).toHaveBeenCalledWith("abcd.efgh.ijkl");
		expect(wrapper.text()).toContain("登录邮箱已更新");
		expect(navigateTo).toHaveBeenCalledWith("/account", { replace: true });
	});

	it("shows the spent-link message for a 400 (invalid/used/expired token)", async () => {
		const wrapped = Object.assign(new Error("Invalid or expired verification link"), {
			statusCode: 400,
		});
		confirmEmailChange.mockRejectedValue(wrapped);
		const wrapper = mountPage({ token: "abc.def" });
		await flushPromises();

		expect(wrapper.text()).toContain("此链接无效或已过期");
		expect(wrapper.text()).not.toContain("登录邮箱已更新");
		// No session adoption -> no navigation.
		expect(navigateTo).not.toHaveBeenCalled();
	});

	it("explains when the target address was taken while the link was pending (409)", async () => {
		confirmEmailChange.mockRejectedValue(
			Object.assign(new Error("already in use"), { statusCode: 409 }),
		);
		const wrapper = mountPage({ token: "abc.def" });
		await flushPromises();

		expect(wrapper.text()).toContain("该邮箱已被其他账号使用");
		expect(wrapper.text()).toContain("返回账号设置");
		expect(navigateTo).not.toHaveBeenCalled();
	});

	it("does not tell the holder their link is spent on a network failure", async () => {
		// A network error is not a business-level rejection: the token may still
		// be valid, so the page must show the retry-later copy, not "invalid".
		confirmEmailChange.mockRejectedValue(new Error("network down"));
		const wrapper = mountPage({ token: "abc.def" });
		await flushPromises();

		expect(wrapper.text()).toContain("网络异常");
		expect(wrapper.text()).not.toContain("此链接无效或已过期");
	});
});
