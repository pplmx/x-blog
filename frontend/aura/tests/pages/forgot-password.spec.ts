/** Reader /forgot-password page tests (DEC-286, TASK-371). */

import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";

// The page dynamic-imports "../../api/reader/auth" at submit time; a module
// mock intercepts that import so the form can be driven without a backend.
const requestPasswordReset = vi.fn();
vi.mock("../../api/reader/auth.ts", () => ({
	requestPasswordReset,
}));

vi.mock("~~/composables/useSeo", () => ({ useSeo: vi.fn() }));

vi.stubGlobal("useRoute", () => ({ query: {} }));

import ForgotPassword from "../../app/pages/forgot-password.vue";

const stubs = {
	Icon: { template: '<svg class="icon-stub" />' },
	NuxtLink: { template: '<a class="nuxt-link-stub"><slot /></a>' },
};

function mountPage() {
	return mount(ForgotPassword, { global: { stubs } });
}

describe("forgot-password page", () => {
	it("renders the request form with a back-to-login link", () => {
		const wrapper = mountPage();
		expect(wrapper.text()).toContain("忘记密码");
		expect(wrapper.find('input[type="email"]').exists()).toBe(true);
		expect(wrapper.find(".nuxt-link-stub").text()).toContain("返回登录");
	});

	it("submits the email and shows the generic 'sent' message", async () => {
		requestPasswordReset.mockResolvedValue({
			data: { value: { message: "ok" } },
			error: { value: null },
		});
		const wrapper = mountPage();
		await wrapper.find('input[type="email"]').setValue("ana@example.test");
		await wrapper.find("form").trigger("submit.prevent");
		await flushPromises();

		expect(requestPasswordReset).toHaveBeenCalledWith({ email: "ana@example.test" });
		// Success replaces the form with the generic message (never reveals
		// whether the address exists — the backend deliberately no-ops unknown mail).
		expect(wrapper.find("form").exists()).toBe(false);
		expect(wrapper.text()).toContain("如果该邮箱已注册");
	});

	it("surfaces a 503 as the localised 'email service' error", async () => {
		requestPasswordReset.mockResolvedValue({
			data: { value: null },
			error: { value: { statusCode: 503 } },
		});
		const wrapper = mountPage();
		await wrapper.find('input[type="email"]').setValue("ana@example.test");
		await wrapper.find("form").trigger("submit.prevent");
		await flushPromises();

		expect(wrapper.find("form").exists()).toBe(true); // form stays for retry
		expect(wrapper.text()).toContain("邮件服务暂不可用");
	});

	it("does not submit an empty email", async () => {
		requestPasswordReset.mockClear();
		const wrapper = mountPage();
		await wrapper.find("form").trigger("submit.prevent");
		await flushPromises();
		expect(requestPasswordReset).not.toHaveBeenCalled();
	});
});
