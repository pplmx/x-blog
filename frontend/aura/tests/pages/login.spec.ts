/** Reader /login page tests (DEC-059, TASK-133). */

import { flushPromises, mount } from "@vue/test-utils";
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

vi.stubGlobal("useRoute", () => ({ query: {} }));

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

	it("announces the active mode via aria-pressed and adapts password autocomplete", async () => {
		const wrapper = mountLogin();
		const buttons = wrapper.findAll("button");
		expect(buttons[0].attributes("aria-pressed")).toBe("true");
		expect(buttons[1].attributes("aria-pressed")).toBe("false");
		// Login mode: password managers fill current-password.
		expect(wrapper.find('input[type="password"]').attributes("autocomplete")).toBe(
			"current-password",
		);

		await buttons[1].trigger("click");
		expect(buttons[0].attributes("aria-pressed")).toBe("false");
		expect(buttons[1].attributes("aria-pressed")).toBe("true");
		// Register mode: a new-password field for the sign-up form.
		expect(wrapper.find('input[type="password"]').attributes("autocomplete")).toBe("new-password");
		// The register-only display-name field is present with a name autocomplete.
		expect(wrapper.find('input[autocomplete="name"]').exists()).toBe(true);
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

	it("ignores a redundant submit while a login is in flight (deep-dive finding)", async () => {
		// A never-resolving login keeps isPending true across a double submit, so
		// the second event (Enter then click, or a pre-paint double-fire) must be
		// dropped instead of issuing two requests.
		loginMock.mockReturnValue(new Promise(() => {})).mockClear();
		const wrapper = mountLogin();
		await wrapper.find('input[type="email"]').setValue("r@example.com");
		await wrapper.find('input[type="password"]').setValue("secret123");
		const form = wrapper.find("form");
		await form.trigger("submit.prevent");
		await form.trigger("submit.prevent");
		await flushPromises();
		expect(loginMock).toHaveBeenCalledTimes(1);
	});
});

describe("login redirect (deep-dive fix)", () => {
	it("navigates to ?redirect= target after a successful sign-in", async () => {
		loginMock.mockResolvedValue({
			access_token: "token",
			token_type: "bearer",
			reader: { id: 1, email: "r@example.com", display_name: null, created_at: null },
		});
		// Override the global route stub for this case.
		vi.stubGlobal("useRoute", () => ({ query: { redirect: "/account" } }));
		vi.stubGlobal("useBookmarkSync", () => ({ mergeLocalToCloud: vi.fn(() => Promise.resolve()) }));
		const navMock = vi.fn();
		vi.stubGlobal("navigateTo", navMock);

		const wrapper = mountLogin();
		await wrapper.find('input[type="email"]').setValue("r@example.com");
		await wrapper.find('input[type="password"]').setValue("secret123");
		await wrapper.find("form").trigger("submit.prevent");
		await flushPromises();

		expect(navMock).toHaveBeenCalledWith("/account", { replace: true });
		vi.unstubAllGlobals();
	});

	it("falls back to /bookmarks for an absolute redirect (no open redirect)", async () => {
		loginMock.mockResolvedValue({
			access_token: "token",
			token_type: "bearer",
			reader: { id: 1, email: "r@example.com", display_name: null, created_at: null },
		});
		vi.stubGlobal("useRoute", () => ({ query: { redirect: "https://evil.example.com" } }));
		vi.stubGlobal("useBookmarkSync", () => ({ mergeLocalToCloud: vi.fn(() => Promise.resolve()) }));
		const navMock = vi.fn();
		vi.stubGlobal("navigateTo", navMock);

		const wrapper = mountLogin();
		await wrapper.find('input[type="email"]').setValue("r@example.com");
		await wrapper.find('input[type="password"]').setValue("secret123");
		await wrapper.find("form").trigger("submit.prevent");
		await flushPromises();

		expect(navMock).toHaveBeenCalledWith("/bookmarks", { replace: true });
		vi.unstubAllGlobals();
	});
});
