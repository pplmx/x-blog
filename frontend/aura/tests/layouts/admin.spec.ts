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
import { nextTick, reactive, ref } from "vue";

import { useTheme } from "../../composables/useTheme";

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

	it("keeps the Posts item lit on the post editor sub-page (ISS-417)", () => {
		// /admin/posts/[id] and /admin/posts/new are the most-used admin surface;
		// the old exact-match comparison left the sidebar with NO item lit there.
		mockRoutePath.value = "/admin/posts/7";
		const wrapper = mountWithBody({
			global: { stubs, slots: { default: "<div>Content</div>" } },
		});
		const links = wrapper.findAll("a");
		const postsLink = links.find((a) => a.text().includes("文章"));
		expect(postsLink).toBeDefined();
		expect(postsLink?.classes().some((c) => c.includes("blue") || c.includes("active"))).toBe(true);
		expect(postsLink?.attributes("aria-current")).toBe("page");
		// …and no OTHER section lights up on the sub-page.
		for (const a of links) {
			if (a === postsLink) continue;
			expect(a.classes().some((c) => c.includes("blue") && a.text().includes("日历"))).toBe(false);
		}
		wrapper.unmount();
	});

	it("keeps only Dashboard lit on /admin itself (not its section children)", () => {
		mockRoutePath.value = "/admin";
		const wrapper = mountWithBody({
			global: { stubs, slots: { default: "<div>Content</div>" } },
		});
		const links = wrapper.findAll("a");
		const dashLink = links.find(
			(a) => a.text().includes("仪表盘") || a.text().includes("Dashboard"),
		);
		expect(dashLink).toBeDefined();
		expect(dashLink?.classes().some((c) => c.includes("blue") || c.includes("active"))).toBe(true);
		// Posts must NOT be lit on bare /admin (prefix match would false-light it).
		const postsLink = links.find((a) => a.text().includes("文章"));
		expect(postsLink?.classes().some((c) => c.includes("blue") || c.includes("active"))).toBe(
			false,
		);
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

	it("shows the Users section for a superuser (default when no role stored)", () => {
		delete localStorageStore.admin_role;
		const wrapper = mountWithBody({ global: { stubs, slots: { default: "<div>Content</div>" } } });
		expect(wrapper.find('a[href="/admin/users"]').exists()).toBe(true);
		// Reader-account moderation is available to every role.
		expect(wrapper.find('a[href="/admin/readers"]').exists()).toBe(true);
		wrapper.unmount();
	});

	it("hides the superuser-only Users section for an editor role", () => {
		localStorageStore.admin_role = "editor";
		const wrapper = mountWithBody({ global: { stubs, slots: { default: "<div>Content</div>" } } });
		expect(wrapper.find('a[href="/admin/users"]').exists()).toBe(false);
		wrapper.unmount();
		delete localStorageStore.admin_role;
	});

	it("opens the mobile drawer with an overlay and closes it via Escape", async () => {
		const wrapper = mountWithBody({ global: { stubs, slots: { default: "<div>Content</div>" } } });
		const menuButton = wrapper.find('button[aria-label="打开菜单"]');
		await menuButton.trigger("click");
		await nextTick();
		expect(wrapper.find(".fixed.inset-0").exists()).toBe(true);

		const aside = wrapper.find("aside");
		await aside.trigger("keydown", { key: "Escape" });
		await nextTick();
		expect(wrapper.find(".fixed.inset-0").exists()).toBe(false);
		expect(menuButton.attributes("aria-expanded")).toBe("false");
		wrapper.unmount();
	});

	it("ignores non-navigation keys inside the open drawer", async () => {
		const wrapper = mountWithBody({ global: { stubs, slots: { default: "<div>Content</div>" } } });
		const menuButton = wrapper.find('button[aria-label="打开菜单"]');
		await menuButton.trigger("click");
		await nextTick();
		expect(wrapper.find(".fixed.inset-0").exists()).toBe(true);

		// A plain key (not Escape/Tab) must leave the drawer open and focused element untouched.
		await wrapper.find("aside").trigger("keydown", { key: "a" });
		await nextTick();
		expect(wrapper.find(".fixed.inset-0").exists()).toBe(true);
		wrapper.unmount();
	});

	it("ignores Escape when the drawer is already closed", async () => {
		const wrapper = mountWithBody({ global: { stubs, slots: { default: "<div>Content</div>" } } });
		const aside = wrapper.find("aside");
		await aside.trigger("keydown", { key: "Escape" });
		await nextTick();
		expect(wrapper.find(".fixed.inset-0").exists()).toBe(false);
		wrapper.unmount();
	});

	it("closes the drawer when the mobile overlay is clicked", async () => {
		const wrapper = mountWithBody({ global: { stubs, slots: { default: "<div>Content</div>" } } });
		const menuButton = wrapper.find('button[aria-label="打开菜单"]');
		await menuButton.trigger("click");
		await nextTick();
		const overlay = wrapper.find(".fixed.inset-0");
		expect(overlay.exists()).toBe(true);

		await overlay.trigger("click");
		await nextTick();
		expect(wrapper.find(".fixed.inset-0").exists()).toBe(false);
		wrapper.unmount();
	});

	it("closes the drawer via the sidebar close button", async () => {
		const wrapper = mountWithBody({ global: { stubs, slots: { default: "<div>Content</div>" } } });
		const menuButton = wrapper.find('button[aria-label="打开菜单"]');
		await menuButton.trigger("click");
		await nextTick();

		const closeBtn = wrapper.find('button[aria-label="关闭菜单"]');
		expect(closeBtn.exists()).toBe(true);
		await closeBtn.trigger("click");
		await nextTick();
		expect(wrapper.find(".fixed.inset-0").exists()).toBe(false);
		wrapper.unmount();
	});

	it("closes the drawer when a sidebar nav item is clicked", async () => {
		const wrapper = mountWithBody({ global: { stubs, slots: { default: "<div>Content</div>" } } });
		const menuButton = wrapper.find('button[aria-label="打开菜单"]');
		await menuButton.trigger("click");
		await nextTick();
		expect(wrapper.find(".fixed.inset-0").exists()).toBe(true);

		const postsLink = wrapper.find('aside a[href="/admin/posts"]');
		await postsLink.trigger("click");
		await nextTick();
		expect(wrapper.find(".fixed.inset-0").exists()).toBe(false);
		wrapper.unmount();
	});

	it("closes the drawer when the back-to-site link is clicked", async () => {
		const wrapper = mountWithBody({ global: { stubs, slots: { default: "<div>Content</div>" } } });
		const menuButton = wrapper.find('button[aria-label="打开菜单"]');
		await menuButton.trigger("click");
		await nextTick();
		expect(wrapper.find(".fixed.inset-0").exists()).toBe(true);

		const backLink = wrapper.find('aside a[href="/"]');
		await backLink.trigger("click");
		await nextTick();
		expect(wrapper.find(".fixed.inset-0").exists()).toBe(false);
		wrapper.unmount();
	});

	it("traps Tab and Shift+Tab inside the open mobile drawer", async () => {
		const wrapper = mountWithBody({ global: { stubs, slots: { default: "<div>Content</div>" } } });
		const menuButton = wrapper.find('button[aria-label="打开菜单"]');
		await menuButton.trigger("click");
		await nextTick();

		const aside = wrapper.find("aside");
		const focusables = aside.findAll("a, button");
		expect(focusables.length).toBeGreaterThan(0);

		// Focus leaves the drawer (behind the overlay)…
		(document.activeElement as HTMLElement | null)?.blur();
		// …a plain Tab wraps focus into the FIRST focusable.
		await aside.trigger("keydown", { key: "Tab" });
		await nextTick();
		expect(aside.element.contains(document.activeElement)).toBe(true);
		expect(document.activeElement).toBe(focusables.at(0)?.element);

		// Shift+Tab from outside wraps to the LAST focusable.
		(document.activeElement as HTMLElement | null)?.blur();
		await aside.trigger("keydown", { key: "Tab", shiftKey: true });
		await nextTick();
		expect(document.activeElement).toBe(focusables.at(-1)?.element);

		// Tab while sitting on the LAST focusable wraps forward to the FIRST.
		const last = focusables.at(-1)?.element as HTMLElement | undefined;
		last?.focus();
		await aside.trigger("keydown", { key: "Tab" });
		await nextTick();
		expect(document.activeElement).toBe(focusables.at(0)?.element);
		wrapper.unmount();
	});

	it("closes the password modal with Escape", async () => {
		const wrapper = mountWithBody({ global: { stubs, slots: { default: "<div>Content</div>" } } });
		const openBtn = wrapper.findAll("button").find((b) => b.text().includes("修改密码"));
		await openBtn?.trigger("click");
		await wrapper.vm.$nextTick();

		const dialog = document.body.querySelector('[role="dialog"]');
		expect(dialog).not.toBeNull();
		await new DOMWrapper(dialog as Element).trigger("keydown", { key: "Escape" });
		await wrapper.vm.$nextTick();
		expect(document.body.querySelector('[role="dialog"]')).toBeNull();
		wrapper.unmount();
	});

	it("ignores non-Escape, non-Tab keys inside the password modal", async () => {
		const wrapper = mountWithBody({ global: { stubs, slots: { default: "<div>Content</div>" } } });
		const openBtn = wrapper.findAll("button").find((b) => b.text().includes("修改密码"));
		await openBtn?.trigger("click");
		await wrapper.vm.$nextTick();

		const dialog = document.body.querySelector('[role="dialog"]') as Element;
		expect(dialog).not.toBeNull();
		await new DOMWrapper(dialog).trigger("keydown", { key: "a" });
		await wrapper.vm.$nextTick();
		// The modal stays open and is not the focus being moved.
		expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
		wrapper.unmount();
	});

	it("traps Tab and Shift+Tab inside the password modal", async () => {
		const wrapper = mountWithBody({ global: { stubs, slots: { default: "<div>Content</div>" } } });
		const openBtn = wrapper.findAll("button").find((b) => b.text().includes("修改密码"));
		await openBtn?.trigger("click");
		await wrapper.vm.$nextTick();

		const dialog = document.body.querySelector('[role="dialog"]') as Element;
		expect(dialog).not.toBeNull();
		const focusables = dialog.querySelectorAll("a[href], button, input, select, textarea");
		expect(focusables.length).toBeGreaterThan(0);

		(document.activeElement as HTMLElement | null)?.blur();
		await new DOMWrapper(dialog).trigger("keydown", { key: "Tab" });
		await wrapper.vm.$nextTick();
		expect(document.activeElement).toBe(focusables[0]);

		(document.activeElement as HTMLElement | null)?.blur();
		await new DOMWrapper(dialog).trigger("keydown", { key: "Tab", shiftKey: true });
		await wrapper.vm.$nextTick();
		expect(document.activeElement).toBe(focusables[focusables.length - 1]);

		// Forward Tab while on the last field wraps back to the first.
		(focusables[focusables.length - 1] as HTMLElement).focus();
		await new DOMWrapper(dialog).trigger("keydown", { key: "Tab" });
		await wrapper.vm.$nextTick();
		expect(document.activeElement).toBe(focusables[0]);
		wrapper.unmount();
	});

	it("shows the generic failure message when a non-Error is thrown", async () => {
		mockFetch.mockRejectedValue("boom"); // a bare string, not an Error
		const wrapper = mountWithBody({ global: { stubs, slots: { default: "<div>Content</div>" } } });
		const openBtn = wrapper.findAll("button").find((b) => b.text().includes("修改密码"));
		await openBtn?.trigger("click");
		await wrapper.vm.$nextTick();

		const passwordInputs = document.body.querySelectorAll('input[type="password"]');
		await new DOMWrapper(passwordInputs[0] as Element).setValue("current");
		await new DOMWrapper(passwordInputs[1] as Element).setValue("newpass123");
		await new DOMWrapper(passwordInputs[2] as Element).setValue("newpass123");

		const submitButton = document.body.querySelector('button[type="submit"]');
		await new DOMWrapper(submitButton as Element).trigger("click");
		await wrapper.vm.$nextTick();

		expect(document.body.textContent || "").toContain("修改密码失败");
		wrapper.unmount();
	});

	it("falls back to a generic error when the API error omits a detail message", async () => {
		mockFetch.mockResolvedValue({ ok: false, json: () => Promise.resolve({}) });
		const wrapper = mountWithBody({ global: { stubs, slots: { default: "<div>Content</div>" } } });
		const openBtn = wrapper.findAll("button").find((b) => b.text().includes("修改密码"));
		await openBtn?.trigger("click");
		await wrapper.vm.$nextTick();

		const passwordInputs = document.body.querySelectorAll('input[type="password"]');
		await new DOMWrapper(passwordInputs[0] as Element).setValue("current");
		await new DOMWrapper(passwordInputs[1] as Element).setValue("newpass123");
		await new DOMWrapper(passwordInputs[2] as Element).setValue("newpass123");

		const submitButton = document.body.querySelector('button[type="submit"]');
		await new DOMWrapper(submitButton as Element).trigger("click");
		await wrapper.vm.$nextTick();

		expect(document.body.textContent || "").toContain("Failed to change password");
		wrapper.unmount();
	});

	it("blocks a second submit while a password change is in flight", async () => {
		mockFetch.mockReturnValue(new Promise(() => {})); // hangs forever
		const wrapper = mountWithBody({ global: { stubs, slots: { default: "<div>Content</div>" } } });
		const openBtn = wrapper.findAll("button").find((b) => b.text().includes("修改密码"));
		await openBtn?.trigger("click");
		await wrapper.vm.$nextTick();

		const passwordInputs = document.body.querySelectorAll('input[type="password"]');
		await new DOMWrapper(passwordInputs[0] as Element).setValue("current");
		await new DOMWrapper(passwordInputs[1] as Element).setValue("newpass123");
		await new DOMWrapper(passwordInputs[2] as Element).setValue("newpass123");

		// First submit starts the in-flight request (fetch never resolves).
		const form = document.body.querySelector("form") as Element;
		const dispatchSubmit = () => {
			const event = new Event("submit", { bubbles: true, cancelable: true });
			event.preventDefault = () => {};
			form.dispatchEvent(event);
		};
		dispatchSubmit();
		await wrapper.vm.$nextTick();
		// A second submit while busy must be ignored — no second fetch.
		dispatchSubmit();
		await wrapper.vm.$nextTick();

		expect(mockFetch).toHaveBeenCalledTimes(1);
		wrapper.unmount();
	});

	it("auto-closes the password modal after a successful change", async () => {
		vi.useFakeTimers();
		mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });

		const wrapper = mountWithBody({ global: { stubs, slots: { default: "<div>Content</div>" } } });
		const openBtn = wrapper.findAll("button").find((b) => b.text().includes("修改密码"));
		await openBtn?.trigger("click");
		await wrapper.vm.$nextTick();

		const passwordInputs = document.body.querySelectorAll('input[type="password"]');
		await new DOMWrapper(passwordInputs[0] as Element).setValue("current");
		await new DOMWrapper(passwordInputs[1] as Element).setValue("newpass123");
		await new DOMWrapper(passwordInputs[2] as Element).setValue("newpass123");

		const submitButton = document.body.querySelector('button[type="submit"]');
		await new DOMWrapper(submitButton as Element).trigger("click");
		await vi.advanceTimersByTimeAsync(0); // let the promise + success settle
		await wrapper.vm.$nextTick();
		expect(document.body.textContent || "").toContain("密码修改成功");

		// The success banner auto-closes after 1500ms.
		await vi.advanceTimersByTimeAsync(1600);
		await wrapper.vm.$nextTick();
		expect(document.body.querySelector('[role="dialog"]')).toBeNull();

		vi.useRealTimers();
		wrapper.unmount();
	});

	it("toggles the theme from the mobile header button", async () => {
		const wrapper = mountWithBody({ global: { stubs, slots: { default: "<div>Content</div>" } } });
		const toggle = wrapper
			.findAll("header button")
			.find((b) => (b.attributes("aria-label") || "").includes("模式"));
		expect(toggle).toBeDefined();
		expect(toggle?.attributes("aria-label")).toBe("切换到深色模式");

		await toggle?.trigger("click");
		await flushPromises();
		expect(toggle?.attributes("aria-label")).toBe("切换到浅色模式");

		useTheme().isDark.value = false;
		delete localStorageStore.theme;
		wrapper.unmount();
	});
});

describe("Admin Layout route-reactive behavior", () => {
	const sharedRoute = reactive({ path: "/admin", query: {} });

	beforeEach(() => {
		sharedRoute.path = "/admin";
		mockIsAuthenticated.value = true;
		vi.stubGlobal("useRoute", () => sharedRoute);
	});

	afterEach(() => {
		vi.stubGlobal("useRoute", () => ({ path: mockRoutePath.value, query: {} }));
	});

	it("closes the mobile drawer when the route changes", async () => {
		const wrapper = mountWithBody({ global: { stubs, slots: { default: "<div>Content</div>" } } });
		const menuButton = wrapper.find('button[aria-label="打开菜单"]');
		await menuButton.trigger("click");
		await nextTick();
		expect(wrapper.find(".fixed.inset-0").exists()).toBe(true);

		sharedRoute.path = "/admin/posts";
		await nextTick();
		expect(wrapper.find(".fixed.inset-0").exists()).toBe(false);
		wrapper.unmount();
	});

	it("re-reads the stored role when the route changes", async () => {
		localStorageStore.admin_role = "editor";
		const wrapper = mountWithBody({ global: { stubs, slots: { default: "<div>Content</div>" } } });
		expect(wrapper.find('a[href="/admin/users"]').exists()).toBe(false);

		// Role flips to superuser in storage, then a route change re-reads it.
		localStorageStore.admin_role = "superuser";
		sharedRoute.path = "/admin/posts";
		await nextTick();
		expect(wrapper.find('a[href="/admin/users"]').exists()).toBe(true);

		delete localStorageStore.admin_role;
		wrapper.unmount();
	});
});
