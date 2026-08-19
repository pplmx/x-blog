/** Reader /login page tests (DEC-059, TASK-133). */

import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import { ref } from "vue";

const loginMock = vi.fn();
const registerMock = vi.fn();
const isAuthenticated = ref(false);

vi.mock("~~/composables/useReaderAuth", () => ({
	useReaderAuth: () => ({
		isAuthenticated,
		login: loginMock,
		register: registerMock,
		logout: vi.fn(),
	}),
}));

vi.mock("~~/composables/useSeo", () => ({ useSeo: vi.fn() }));

import Login from "../../app/pages/login.vue";

const stubs = {
	Icon: { template: '<svg class="icon-stub" />' },
	NuxtLink: { template: '<a class="nuxt-link-stub"><slot /></a>' },
};

function mountLogin() {
	return mount(Login, {
		global: { stubs },
	});
}

describe("login page", () => {
	it("renders sign-in mode by default", () => {
		const wrapper = mountLogin();
		expect(wrapper.exists()).toBe(true);
		expect(wrapper.text()).toContain("登录"); // zh default (see setup.ts)
	});

	it("switches to register mode", async () => {
		const wrapper = mountLogin();
		const buttons = wrapper.findAll("button");
		// the toggle has two buttons; the second is "Register"
		await buttons[1].trigger("click");
		expect(wrapper.vm.$data.mode ?? wrapper.vm.mode).toBe("register");
	});

	it("submits login with email + password", async () => {
		loginMock.mockResolvedValue({
			access_token: "token",
			token_type: "bearer",
			reader: { id: 1, email: "r@example.com", display_name: null, created_at: null },
		});
		const wrapper = mountLogin();
		await wrapper.find('input[type="email"]').setValue("r@example.com");
		await wrapper.find('input[type="password"]').setValue("secret123");
		await wrapper.find("form").trigger("submit.prevent");
		expect(loginMock).toHaveBeenCalledWith("r@example.com", "secret123");
	});
});
