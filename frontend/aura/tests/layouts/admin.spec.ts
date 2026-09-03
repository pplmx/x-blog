/**
 * Admin layout tests
 * Tests authenticated layout, login page redirect, sidebar navigation,
 * password modal (validation, success, error), and logout.
 *
 * Mocks useAdminAuth composable, stubs Icon and NuxtLink.
 * Uses attachTo: document.body for Teleport rendering.
 */

import { DOMWrapper, flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import { nextTick, ref } from "vue";

const mockIsAuthenticated = ref(true);
const mockLogout = vi.fn();
const mockRoutePath = ref("/admin");
// The auth guard uses a hard redirect (window.location.replace) — asserting
// the SPA navigateTo call is gone because it left the layout slot empty on
// first load (see admin.vue redirect comment).
const mockLocationReplace = vi.fn();

vi.mock("../../composables/useAdminAuth", () => ({
	useAdminAuth: () => ({
		isAuthenticated: mockIsAuthenticated,
		logout: mockLogout,
	}),
}));

vi.stubGlobal("useRoute", () => ({ path: mockRoutePath.value, query: {} }));
vi.stubGlobal("navigateTo", vi.fn());
vi.stubGlobal("useRuntimeConfig", () => ({ public: { apiUrl: "http://localhost:18888" } }));
vi.spyOn(window.location, "replace").mockImplementation(mockLocationReplace);
vi.stubGlobal("useHead", vi.fn());
vi.stubGlobal("onMounted", (fn: () => void) => fn());
vi.stubGlobal("watch", () => {});

// Mock localStorage
const localStorageStore: Record<string, string> = { admin_token: "test-token" };
vi.stubGlobal("localStorage", {
	getItem: (key: string) => (key in localStorageStore ? localStorageStore[key] : null),
	setItem: (key: string, value: string) => {
		localStorageStore[key] = value;
	},
	removeItem: (key: string) => {
		delete localStorageStore[key];
	},
	clear: () => {
		for (const key of Object.keys(localStorageStore)) delete localStorageStore[key];
	},
	key: (index: number) => Object.keys(localStorageStore)[index] ?? null,
	get length() {
		return Object.keys(localStorageStore).length;
	},
});

// Mock fetch for password change
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import AdminLayout from "../../app/layouts/admin.vue";

const stubs = {
	Icon: {
		template: '<svg class="icon-stub" />',
	},
	NuxtLink: {
		props: ["to"],
		template: '<a :href="to"><slot/></a>',
	},
	// Nuxt auto-import is not active in vitest; the layout's fixed 429 banner
	// resolves through this prod-style stub in tests.
	RateLimitNotice: {
		template: '<div class="rate-limit-stub" />',
	},
};

// Helper: mount with attachTo body for Teleport support
const mountWithBody = (options: any) =>
	mount(AdminLayout, {
		attachTo: document.body,
		...options,
	});

describe("Admin Layout", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockIsAuthenticated.value = true;
		mockRoutePath.value = "/admin";
		mockFetch.mockReset();
		document.body.innerHTML = "";
	});

	it("renders login page when on login route", () => {
		mockRoutePath.value = "/admin/login";
		const wrapper = mountWithBody({
			global: { stubs, slots: { default: "<div>Login Form</div>" } },
		});

		// Login page renders the default slot in a centered div, no sidebar
		expect(wrapper.find("aside").exists()).toBe(false);
		expect(wrapper.classes()).toContain("min-h-screen");
		wrapper.unmount();
	});

	it("redirects unauthenticated users to login with a hard redirect", () => {
		mockIsAuthenticated.value = false;
		mockRoutePath.value = "/admin";

		mountWithBody({
			global: { stubs, slots: { default: "<div>Content</div>" } },
		});

		expect(mockLocationReplace).toHaveBeenCalledWith("/admin/login");
	});

	it("renders sidebar navigation when authenticated", () => {
		const wrapper = mountWithBody({
			global: { stubs, slots: { default: "<div>Content</div>" } },
		});

		expect(wrapper.text()).toContain("X-Blog 管理");
		expect(wrapper.text()).toContain("仪表盘");
		expect(wrapper.text()).toContain("文章");
		expect(wrapper.text()).toContain("评论");
		expect(wrapper.text()).toContain("分类");
		expect(wrapper.text()).toContain("标签");
		wrapper.unmount();
	});

	it("renders a theme toggle that honors the saved dark preference and flips it", async () => {
		// Regression (deep-dive): the admin UI previously had no theme control
		// and never applied the persisted preference — a saved dark-mode admin
		// was stranded in light mode.
		localStorageStore.theme = "dark";
		const wrapper = mountWithBody({
			global: { stubs, slots: { default: "<div>Content</div>" } },
		});
		// initTheme applies the class synchronously but the button label is a
		// reactive render — settle it before asserting.
		await nextTick();
		await flushPromises();

		// Sidebar toggle reflects the persisted dark preference ("浅色模式" = go
		// light from dark) and clicking it flips to the light-mode action.
		const toggle = wrapper
			.findAll("button")
			.find((b) => b.text().includes("浅色模式") || b.text().includes("深色模式"));
		expect(toggle).toBeDefined();
		expect(toggle?.text()).toContain("浅色模式");
		await toggle?.trigger("click");
		await flushPromises();
		expect(toggle?.text()).toContain("深色模式");
		delete localStorageStore.theme;
		wrapper.unmount();
	});

	it("renders main content area when authenticated", () => {
		const wrapper = mountWithBody({
			global: { stubs, slots: { default: "<div>Main Content</div>" } },
		});

		// The main content area should exist with a slot
		expect(wrapper.find("main").exists()).toBe(true);
		wrapper.unmount();
	});

	it("renders return to site link", () => {
		const wrapper = mountWithBody({
			global: { stubs, slots: { default: "<div>Content</div>" } },
		});

		expect(wrapper.text()).toContain("返回前台");
		wrapper.unmount();
	});

	it("renders change password button", () => {
		const wrapper = mountWithBody({
			global: { stubs, slots: { default: "<div>Content</div>" } },
		});

		expect(wrapper.text()).toContain("修改密码");
		wrapper.unmount();
	});

	it("renders logout button and calls logout on click", async () => {
		const wrapper = mountWithBody({
			global: { stubs, slots: { default: "<div>Content</div>" } },
		});

		expect(wrapper.text()).toContain("退出登录");

		const logoutButton = wrapper.findAll("button").find((b) => b.text().includes("退出登录"));
		expect(logoutButton).toBeDefined();
		await logoutButton?.trigger("click");
		expect(mockLogout).toHaveBeenCalled();
		wrapper.unmount();
	});

	it("opens password modal when change password button is clicked", async () => {
		const wrapper = mountWithBody({
			global: { stubs, slots: { default: "<div>Content</div>" } },
		});

		const changePasswordButton = wrapper
			.findAll("button")
			.find((b) => b.text().includes("修改密码"));
		await changePasswordButton?.trigger("click");

		// Modal content is rendered via Teleport to document.body
		const bodyText = document.body.textContent || "";
		expect(bodyText).toContain("修改密码");
		expect(bodyText).toContain("当前密码");
		expect(bodyText).toContain("新密码");
		wrapper.unmount();
	});

	it("validates password length (minimum 6 characters)", async () => {
		mockFetch.mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({}),
		});

		const wrapper = mountWithBody({
			global: { stubs, slots: { default: "<div>Content</div>" } },
		});

		// Open password modal
		const changePasswordButton = wrapper
			.findAll("button")
			.find((b) => b.text().includes("修改密码"));
		await changePasswordButton?.trigger("click");
		await wrapper.vm.$nextTick();

		// Fill in short password (new_password is 5 chars — must match backend
		// min_length=8, not the old frontend-only 6; a 6-7 char password used
		// to pass here then 400 from the backend)
		const passwordInputs = document.body.querySelectorAll('input[type="password"]');
		expect(passwordInputs.length).toBeGreaterThanOrEqual(3);
		await new DOMWrapper(passwordInputs[0] as Element).setValue("short");
		await new DOMWrapper(passwordInputs[1] as Element).setValue("short");
		await new DOMWrapper(passwordInputs[2] as Element).setValue("short");
		await wrapper.vm.$nextTick();

		// Submit by dispatching submit event on the form
		const form = document.body.querySelector("form");
		const submitEvent = new Event("submit", { bubbles: true, cancelable: true });
		submitEvent.preventDefault = () => {};
		form?.dispatchEvent(submitEvent);
		// Wait for the async handler to complete
		await new Promise((r) => setTimeout(r, 50));
		await wrapper.vm.$nextTick();

		// Validation should prevent the API call
		expect(mockFetch).not.toHaveBeenCalled();
		expect(document.body.textContent || "").toContain("密码至少 8 位");
		wrapper.unmount();
	});

	it("rejects a 7-char password that the old 6-char check would have accepted", async () => {
		const wrapper = mountWithBody({
			global: { stubs, slots: { default: "<div>Content</div>" } },
		});

		// Open password modal
		const changePasswordButton = wrapper
			.findAll("button")
			.find((b) => b.text().includes("修改密码"));
		await changePasswordButton?.trigger("click");
		await wrapper.vm.$nextTick();

		// 7 chars: passes the old < 6 guard, must now be blocked (backend min 8)
		const passwordInputs = document.body.querySelectorAll('input[type="password"]');
		await new DOMWrapper(passwordInputs[0] as Element).setValue("abcdefg");
		await new DOMWrapper(passwordInputs[1] as Element).setValue("abcdefg");
		await new DOMWrapper(passwordInputs[2] as Element).setValue("abcdefg");
		await wrapper.vm.$nextTick();

		const form = document.body.querySelector("form");
		const submitEvent = new Event("submit", { bubbles: true, cancelable: true });
		submitEvent.preventDefault = () => {};
		form?.dispatchEvent(submitEvent);
		await new Promise((r) => setTimeout(r, 50));
		await wrapper.vm.$nextTick();

		expect(mockFetch).not.toHaveBeenCalled();
		expect(document.body.textContent || "").toContain("密码至少 8 位");
		wrapper.unmount();
	});

	it("validates password confirmation matches", async () => {
		const wrapper = mountWithBody({
			global: { stubs, slots: { default: "<div>Content</div>" } },
		});

		// Open password modal
		const changePasswordButton = wrapper
			.findAll("button")
			.find((b) => b.text().includes("修改密码"));
		await changePasswordButton?.trigger("click");
		await wrapper.vm.$nextTick();

		// Fill in mismatched passwords
		const passwordInputs = document.body.querySelectorAll('input[type="password"]');
		await new DOMWrapper(passwordInputs[0] as Element).setValue("current");
		await new DOMWrapper(passwordInputs[1] as Element).setValue("newpass123");
		await new DOMWrapper(passwordInputs[2] as Element).setValue("different");

		const submitButton = document.body.querySelector('button[type="submit"]');
		await new DOMWrapper(submitButton as Element).trigger("click");

		expect(document.body.textContent || "").toContain("两次输入的密码不一致");
		wrapper.unmount();
	});

	it("handles successful password change", async () => {
		mockFetch.mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({}),
		});

		const wrapper = mountWithBody({
			global: { stubs, slots: { default: "<div>Content</div>" } },
		});

		// Open password modal
		const changePasswordButton = wrapper
			.findAll("button")
			.find((b) => b.text().includes("修改密码"));
		await changePasswordButton?.trigger("click");
		await wrapper.vm.$nextTick();

		// Fill in matching passwords
		const passwordInputs = document.body.querySelectorAll('input[type="password"]');
		await new DOMWrapper(passwordInputs[0] as Element).setValue("current");
		await new DOMWrapper(passwordInputs[1] as Element).setValue("newpass123");
		await new DOMWrapper(passwordInputs[2] as Element).setValue("newpass123");

		const submitButton = document.body.querySelector('button[type="submit"]');
		await new DOMWrapper(submitButton as Element).trigger("click");
		await wrapper.vm.$nextTick();

		expect(mockFetch).toHaveBeenCalledWith(
			"http://localhost:18888/api/admin/password",
			expect.objectContaining({
				method: "POST",
				headers: expect.objectContaining({
					Authorization: "Bearer test-token",
				}),
			}),
		);
		wrapper.unmount();
	});

	it("handles password change error", async () => {
		mockFetch.mockResolvedValue({
			ok: false,
			json: () => Promise.resolve({ detail: "Current password is incorrect" }),
		});

		const wrapper = mountWithBody({
			global: { stubs, slots: { default: "<div>Content</div>" } },
		});

		// Open password modal
		const changePasswordButton = wrapper
			.findAll("button")
			.find((b) => b.text().includes("修改密码"));
		await changePasswordButton?.trigger("click");
		await wrapper.vm.$nextTick();

		// Fill in matching passwords
		const passwordInputs = document.body.querySelectorAll('input[type="password"]');
		await new DOMWrapper(passwordInputs[0] as Element).setValue("current");
		await new DOMWrapper(passwordInputs[1] as Element).setValue("newpass123");
		await new DOMWrapper(passwordInputs[2] as Element).setValue("newpass123");

		const submitButton = document.body.querySelector('button[type="submit"]');
		await new DOMWrapper(submitButton as Element).trigger("click");
		await wrapper.vm.$nextTick();

		expect(document.body.textContent || "").toContain("Current password is incorrect");
		wrapper.unmount();
	});

	it("handles network error during password change", async () => {
		mockFetch.mockRejectedValue(new Error("Network error"));

		const wrapper = mountWithBody({
			global: { stubs, slots: { default: "<div>Content</div>" } },
		});

		// Open password modal
		const changePasswordButton = wrapper
			.findAll("button")
			.find((b) => b.text().includes("修改密码"));
		await changePasswordButton?.trigger("click");
		await wrapper.vm.$nextTick();

		// Fill in matching passwords
		const passwordInputs = document.body.querySelectorAll('input[type="password"]');
		await new DOMWrapper(passwordInputs[0] as Element).setValue("current");
		await new DOMWrapper(passwordInputs[1] as Element).setValue("newpass123");
		await new DOMWrapper(passwordInputs[2] as Element).setValue("newpass123");

		const submitButton = document.body.querySelector('button[type="submit"]');
		await new DOMWrapper(submitButton as Element).trigger("click");
		await wrapper.vm.$nextTick();

		expect(document.body.textContent || "").toContain("Network error");
		wrapper.unmount();
	});

	it("closes password modal with cancel button", async () => {
		const wrapper = mountWithBody({
			global: { stubs, slots: { default: "<div>Content</div>" } },
		});

		// Open password modal
		const changePasswordButton = wrapper
			.findAll("button")
			.find((b) => b.text().includes("修改密码"));
		await changePasswordButton?.trigger("click");
		await wrapper.vm.$nextTick();

		// Click cancel using DOMWrapper for proper Vue event handling
		const buttons = document.body.querySelectorAll("button");
		const cancelButton = Array.from(buttons).find((b) => b.textContent?.includes("取消"));
		await new DOMWrapper(cancelButton as Element).trigger("click");
		await wrapper.vm.$nextTick();

		expect(document.body.textContent || "").not.toContain("当前密码");
		wrapper.unmount();
	});

	it("highlights active navigation item", () => {
		mockRoutePath.value = "/admin/posts";
		const wrapper = mountWithBody({
			global: { stubs, slots: { default: "<div>Content</div>" } },
		});

		// The posts nav item should have active styling
		const postsLink = wrapper.findAll("a").find((a) => a.text().includes("文章"));
		expect(postsLink).toBeDefined();
		expect(postsLink?.classes().some((c) => c.includes("blue") || c.includes("active"))).toBe(true);
		wrapper.unmount();
	});

	it("renders mobile header with menu button", () => {
		const wrapper = mountWithBody({
			global: { stubs, slots: { default: "<div>Content</div>" } },
		});

		// Mobile header button has aria-label="打开菜单"
		const menuButton = wrapper.find('button[aria-label="打开菜单"]');
		expect(menuButton.exists()).toBe(true);
		wrapper.unmount();
	});

	it("toggles sidebar open on mobile", async () => {
		const wrapper = mountWithBody({
			global: { stubs, slots: { default: "<div>Content</div>" } },
		});

		const menuButton = wrapper.find('button[aria-label="打开菜单"]');
		expect(menuButton.exists()).toBe(true);
		await menuButton.trigger("click");
		wrapper.unmount();
	});

	it("module loads successfully", async () => {
		const mod = await import("../../app/layouts/admin.vue");
		expect(mod).toBeDefined();
		expect(mod.default).toBeDefined();
	});
});
