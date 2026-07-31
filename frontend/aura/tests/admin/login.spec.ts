/**
 * Admin Login Page Tests
 *
 * Tests the admin login form: rendering, validation (empty fields),
 * successful login flow (stores token, navigates), and error handling
 * (API failure shows error message).
 *
 * Mocks the adminLoginRequest composable and useAdminAuth composable
 * to test the login page in isolation, following the same patterns
 * as the page tests (stubbed NuxtLink/Icon, Suspense for async).
 */

import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import { NuxtLinkStub } from "./helpers.ts";

// Mock composable functions BEFORE importing the component.
// The login page imports useAdminAuth (for login) and adminLoginRequest
// (for the API call). We mock both so we can verify the interaction.
const { mockLogin, mockAdminLoginRequest } = vi.hoisted(() => ({
	mockLogin: vi.fn(),
	mockAdminLoginRequest: vi.fn(),
}));

vi.mock("~/composables/useAdminAuth", () => ({
	useAdminAuth: () => ({
		login: mockLogin,
		isAuthenticated: ref(false),
		logout: vi.fn(),
	}),
	adminLoginRequest: mockAdminLoginRequest,
}));

// Mock useRuntimeConfig so the component can read apiUrl if needed
vi.stubGlobal("useRuntimeConfig", () => ({
	public: { apiUrl: "http://localhost:18888" },
}));
vi.stubGlobal("navigateTo", vi.fn());
vi.stubGlobal("useHead", vi.fn());
vi.stubGlobal("definePageMeta", vi.fn());

// Stub the Icon component used in the login page template
const IconStubComponent = {
	props: ["icon", "width", "height", "class"],
	template: '<svg class="iconstub" :data-icon="icon" />',
};

async function loadLoginPage() {
	const { default: LoginPage } = await import("@/pages/admin/login.vue");
	return LoginPage;
}

describe("Admin Login Page", () => {
	afterEach(() => {
		vi.restoreAllMocks();
		vi.clearAllMocks();
	});

	describe("Rendering", () => {
		it("renders the login heading", async () => {
			const LoginPage = await loadLoginPage();
			const wrapper = mount(LoginPage, {
				global: {
					stubs: { NuxtLink: NuxtLinkStub, Icon: IconStubComponent },
				},
			});
			expect(wrapper.text()).toContain("管理员登录");
		});

		it("renders username and password input fields", async () => {
			const LoginPage = await loadLoginPage();
			const wrapper = mount(LoginPage, {
				global: {
					stubs: { NuxtLink: NuxtLinkStub, Icon: IconStubComponent },
				},
			});
			const inputs = wrapper.findAll("input");
			expect(inputs).toHaveLength(2);
			expect(inputs[0].attributes("type")).toBe("text");
			expect(inputs[1].attributes("type")).toBe("password");
		});

		it("renders a submit button", async () => {
			const LoginPage = await loadLoginPage();
			const wrapper = mount(LoginPage, {
				global: {
					stubs: { NuxtLink: NuxtLinkStub, Icon: IconStubComponent },
				},
			});
			const submitButton = wrapper.find('button[type="submit"]');
			expect(submitButton.exists()).toBe(true);
			expect(submitButton.text()).toContain("登录");
		});

		it("renders a link back to blog homepage", async () => {
			const LoginPage = await loadLoginPage();
			const wrapper = mount(LoginPage, {
				global: {
					stubs: { NuxtLink: NuxtLinkStub, Icon: IconStubComponent },
				},
			});
			const backLink = wrapper.find('a[href="/"]');
			expect(backLink.exists()).toBe(true);
		});
	});

	describe("Form validation", () => {
		it("disables submit button when username is empty", async () => {
			const LoginPage = await loadLoginPage();
			const wrapper = mount(LoginPage, {
				global: {
					stubs: { NuxtLink: NuxtLinkStub, Icon: IconStubComponent },
				},
			});
			const submitButton = wrapper.find('button[type="submit"]');
			expect(submitButton.attributes("disabled")).toBeDefined();
		});

		it("enables submit button when both fields are filled", async () => {
			const LoginPage = await loadLoginPage();
			const wrapper = mount(LoginPage, {
				global: {
					stubs: { NuxtLink: NuxtLinkStub, Icon: IconStubComponent },
				},
			});
			const inputs = wrapper.findAll("input");
			await inputs[0].setValue("admin");
			await inputs[1].setValue("password");
			await flushPromises();
			const submitButton = wrapper.find('button[type="submit"]');
			expect(submitButton.attributes("disabled")).toBeUndefined();
		});
	});

	describe("Login flow", () => {
		it("calls adminLoginRequest with username and password on submit", async () => {
			const LoginPage = await loadLoginPage();
			const wrapper = mount(LoginPage, {
				global: {
					stubs: { NuxtLink: NuxtLinkStub, Icon: IconStubComponent },
				},
			});

			const fakeTokenResult = {
				data: ref({ access_token: "fake-jwt-token" }),
				error: ref(null),
			};
			mockAdminLoginRequest.mockResolvedValue(fakeTokenResult);

			const inputs = wrapper.findAll("input");
			await inputs[0].setValue("admin");
			await inputs[1].setValue("secretpass");
			await wrapper.find("form").trigger("submit.prevent");
			await flushPromises();

			expect(mockAdminLoginRequest).toHaveBeenCalledWith("admin", "secretpass");
		});

		it("calls login with the access token on successful login", async () => {
			const LoginPage = await loadLoginPage();
			const wrapper = mount(LoginPage, {
				global: {
					stubs: { NuxtLink: NuxtLinkStub, Icon: IconStubComponent },
				},
			});

			mockAdminLoginRequest.mockResolvedValue({
				data: ref({ access_token: "fake-jwt-token" }),
				error: ref(null),
			});

			const inputs = wrapper.findAll("input");
			await inputs[0].setValue("admin");
			await inputs[1].setValue("secretpass");
			await wrapper.find("form").trigger("submit.prevent");
			await flushPromises();

			expect(mockLogin).toHaveBeenCalledWith("fake-jwt-token");
		});

		it("navigates to /admin/posts on successful login", async () => {
			const LoginPage = await loadLoginPage();
			const wrapper = mount(LoginPage, {
				global: {
					stubs: { NuxtLink: NuxtLinkStub, Icon: IconStubComponent },
				},
			});

			mockAdminLoginRequest.mockResolvedValue({
				data: ref({ access_token: "fake-jwt-token" }),
				error: ref(null),
			});

			const inputs = wrapper.findAll("input");
			await inputs[0].setValue("admin");
			await inputs[1].setValue("secretpass");
			await wrapper.find("form").trigger("submit.prevent");
			await flushPromises();

			expect(navigateTo).toHaveBeenCalledWith("/admin/posts", {
				replace: true,
			});
		});

		it("shows error message when login API returns an error", async () => {
			const LoginPage = await loadLoginPage();
			const wrapper = mount(LoginPage, {
				global: {
					stubs: { NuxtLink: NuxtLinkStub, Icon: IconStubComponent },
				},
			});

			mockAdminLoginRequest.mockResolvedValue({
				data: ref(null),
				error: ref({ message: "Invalid credentials" }),
			});

			const inputs = wrapper.findAll("input");
			await inputs[0].setValue("baduser");
			await inputs[1].setValue("badpass");
			await wrapper.find("form").trigger("submit.prevent");
			await flushPromises();

			expect(wrapper.text()).toContain("登录失败");
			expect(mockLogin).not.toHaveBeenCalled();
		});

		it("shows error message when no access token is returned", async () => {
			const LoginPage = await loadLoginPage();
			const wrapper = mount(LoginPage, {
				global: {
					stubs: { NuxtLink: NuxtLinkStub, Icon: IconStubComponent },
				},
			});

			mockAdminLoginRequest.mockResolvedValue({
				data: ref({}),
				error: ref(null),
			});

			const inputs = wrapper.findAll("input");
			await inputs[0].setValue("admin");
			await inputs[1].setValue("password");
			await wrapper.find("form").trigger("submit.prevent");
			await flushPromises();

			expect(wrapper.text()).toContain("登录失败");
		});

		it("shows network error when login throws an exception", async () => {
			const LoginPage = await loadLoginPage();
			const wrapper = mount(LoginPage, {
				global: {
					stubs: { NuxtLink: NuxtLinkStub, Icon: IconStubComponent },
				},
			});

			mockAdminLoginRequest.mockRejectedValue(new Error("Network error"));

			const inputs = wrapper.findAll("input");
			await inputs[0].setValue("admin");
			await inputs[1].setValue("password");
			await wrapper.find("form").trigger("submit.prevent");
			await flushPromises();

			expect(wrapper.text()).toContain("登录失败");
		});

		it("shows loading state while login is pending", async () => {
			const LoginPage = await loadLoginPage();
			const wrapper = mount(LoginPage, {
				global: {
					stubs: { NuxtLink: NuxtLinkStub, Icon: IconStubComponent },
				},
			});

			// Create a promise we can control
			let resolveLogin: (value: any) => void;
			const pendingPromise = new Promise((resolve) => {
				resolveLogin = resolve;
			});
			mockAdminLoginRequest.mockReturnValue(pendingPromise);

			const inputs = wrapper.findAll("input");
			await inputs[0].setValue("admin");
			await inputs[1].setValue("password");
			await wrapper.find("form").trigger("submit.prevent");

			// Should show loading state
			expect(wrapper.text()).toContain("登录中");

			// Resolve the login
			resolveLogin?.({
				data: ref({ access_token: "token" }),
				error: ref(null),
			});
			await flushPromises();
		});
	});
});
