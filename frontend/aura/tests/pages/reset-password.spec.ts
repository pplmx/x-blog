/** Reader /reset-password page tests (DEC-286, TASK-371). */

import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";

// The page calls useReaderAuth().resetPassword() (dynamic-imported API behind it).
const resetPassword = vi.fn();
vi.mock("~~/composables/useReaderAuth", () => ({
	useReaderAuth: () => ({ resetPassword }),
}));

vi.mock("~~/composables/useSeo", () => ({ useSeo: vi.fn() }));

let routeQuery: Record<string, unknown> = {};
vi.stubGlobal("useRoute", () => ({ query: routeQuery }));

import ReserPassword from "../../app/pages/reset-password.vue";

const stubs = {
	Icon: { template: '<svg class="icon-stub" />' },
	NuxtLink: { template: '<a class="nuxt-link-stub"><slot /></a>' },
};

const navigateTo = vi.fn().mockResolvedValue(undefined);
vi.stubGlobal("navigateTo", navigateTo);

function mountPage(query: Record<string, unknown> = {}) {
	routeQuery = query;
	return mount(ReserPassword, { global: { stubs } });
}

describe("reset-password page", () => {
	it("shows the invalid-link message when no token is present", () => {
		const wrapper = mountPage({});
		expect(wrapper.text()).toContain("重置链接无效或已过期");
		expect(wrapper.find("form").exists()).toBe(false);
	});

	it("redeems the token with matching passwords and signs the reader in", async () => {
		resetPassword.mockResolvedValue({ access_token: "x", reader: { email: "ana@example.test" } });
		const wrapper = mountPage({ token: "abc.def.ghi" });
		const inputs = wrapper.findAll('input[type="password"]');
		await inputs[0].setValue("brandnew456");
		await inputs[1].setValue("brandnew456");
		await wrapper.find("form").trigger("submit.prevent");
		await flushPromises();

		expect(resetPassword).toHaveBeenCalledWith("abc.def.ghi", "brandnew456");
		expect(navigateTo).toHaveBeenCalledWith("/account", { replace: true });
	});

	it("does not submit when the passwords do not match", async () => {
		resetPassword.mockClear();
		const wrapper = mountPage({ token: "abc.def.ghi" });
		const inputs = wrapper.findAll('input[type="password"]');
		await inputs[0].setValue("brandnew456");
		await inputs[1].setValue("different99");
		await wrapper.find("form").trigger("submit.prevent");
		await flushPromises();

		expect(resetPassword).not.toHaveBeenCalled();
		expect(wrapper.text()).toContain("两次输入的密码不一致");
	});

	it("surfaces a 400 (used/expired token) as the invalid-link error", async () => {
		const wrapped = Object.assign(new Error("Invalid or expired reset link"), { statusCode: 400 });
		resetPassword.mockRejectedValue(wrapped);
		const wrapper = mountPage({ token: "abc.def.ghi" });
		const inputs = wrapper.findAll('input[type="password"]');
		await inputs[0].setValue("brandnew456");
		await inputs[1].setValue("brandnew456");
		await wrapper.find("form").trigger("submit.prevent");
		await flushPromises();

		expect(wrapper.text()).toContain("重置链接无效或已过期");
	});
});
