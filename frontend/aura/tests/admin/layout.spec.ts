/**
 * Admin Layout Tests
 *
 * Tests the admin layout: auth guard (redirects unauthenticated users
 * to login), sidebar navigation links, back-to-foreground link,
 * logout button, and active nav highlighting.
 *
 * The layout is tested by mounting it as a wrapper component that
 * provides slot content, then checking the rendered output.
 */

import { mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";

// We need to use a module-level ref for authentication state
// that the mock can access. Use vi.hoisted for the mock functions.
const { mockLogout } = vi.hoisted(() => ({
	mockLogout: vi.fn(),
}));

// Default auth state — can be toggled in tests
const mockAuthState = ref(true);

vi.mock("~/composables/useAdminAuth", () => ({
	useAdminAuth: () => ({
		isAuthenticated: mockAuthState,
		login: vi.fn(),
		logout: mockLogout,
	}),
}));

vi.stubGlobal("useRuntimeConfig", () => ({
	public: { apiUrl: "http://localhost:18888" },
}));
vi.stubGlobal("navigateTo", vi.fn());
	vi.stubGlobal("useHead", vi.fn());

const IconStubComponent = {
	props: ["icon", "width", "height", "class"],
	template: '<svg class="iconstub" :data-icon="icon" />',
};

const NuxtLinkStub = {
	props: ["to"],
	template: '<a :href="to"><slot/></a>',
};

describe("Admin Layout", () => {
	afterEach(() => {
		vi.restoreAllMocks();
		vi.clearAllMocks();
		mockAuthState.value = true;
	});

	describe("Authenticated state", () => {
		beforeEach(() => {
			mockAuthState.value = true;
		});

		it("renders the sidebar with navigation", async () => {
			vi.stubGlobal("useRoute", () => ({
				path: "/admin",
				params: {},
				query: {},
			}));
			const { default: AdminLayout } = await import("@/layouts/admin.vue");
			const wrapper = mount(AdminLayout, {
				global: {
					stubs: { Icon: IconStubComponent, NuxtLink: NuxtLinkStub },
				},
				slots: { default: '<div class="page-content">Page Content</div>' },
			});

			expect(wrapper.text()).toContain("X-Blog 管理");
			expect(wrapper.text()).toContain("仪表盘");
			expect(wrapper.text()).toContain("文章");
			expect(wrapper.text()).toContain("评论");
			expect(wrapper.text()).toContain("分类");
			expect(wrapper.text()).toContain("标签");
		});

		it("renders the page content in the main slot", async () => {
			vi.stubGlobal("useRoute", () => ({
				path: "/admin",
				params: {},
				query: {},
			}));
			const { default: AdminLayout } = await import("@/layouts/admin.vue");
			const wrapper = mount(AdminLayout, {
				global: {
					stubs: { Icon: IconStubComponent, NuxtLink: NuxtLinkStub },
				},
				slots: { default: '<div class="page-content">Page Content</div>' },
			});

			expect(wrapper.find(".page-content").exists()).toBe(true);
			expect(wrapper.text()).toContain("Page Content");
		});

		it("renders links to all admin pages", async () => {
			vi.stubGlobal("useRoute", () => ({
				path: "/admin",
				params: {},
				query: {},
			}));
			const { default: AdminLayout } = await import("@/layouts/admin.vue");
			const wrapper = mount(AdminLayout, {
				global: {
					stubs: { Icon: IconStubComponent, NuxtLink: NuxtLinkStub },
				},
				slots: { default: "<div>Content</div>" },
			});

			expect(wrapper.find('a[href="/admin"]').exists()).toBe(true);
			expect(wrapper.find('a[href="/admin/posts"]').exists()).toBe(true);
			expect(wrapper.find('a[href="/admin/comments"]').exists()).toBe(true);
			expect(wrapper.find('a[href="/admin/categories"]').exists()).toBe(true);
			expect(wrapper.find('a[href="/admin/tags"]').exists()).toBe(true);
		});

		it("renders a back-to-foreground link", async () => {
			vi.stubGlobal("useRoute", () => ({
				path: "/admin",
				params: {},
				query: {},
			}));
			const { default: AdminLayout } = await import("@/layouts/admin.vue");
			const wrapper = mount(AdminLayout, {
				global: {
					stubs: { Icon: IconStubComponent, NuxtLink: NuxtLinkStub },
				},
				slots: { default: "<div>Content</div>" },
			});

			expect(wrapper.find('a[href="/"]').exists()).toBe(true);
			expect(wrapper.text()).toContain("返回前台");
		});

		it("renders a password change button", async () => {
			vi.stubGlobal("useRoute", () => ({
				path: "/admin",
				params: {},
				query: {},
			}));
			const { default: AdminLayout } = await import("@/layouts/admin.vue");
			const wrapper = mount(AdminLayout, {
				global: {
					stubs: { Icon: IconStubComponent, NuxtLink: NuxtLinkStub },
				},
				slots: { default: "<div>Content</div>" },
			});
			expect(wrapper.text()).toContain("修改密码");
		});

		it("renders a logout button", async () => {
			vi.stubGlobal("useRoute", () => ({
				path: "/admin",
				params: {},
				query: {},
			}));
			const { default: AdminLayout } = await import("@/layouts/admin.vue");
			const wrapper = mount(AdminLayout, {
				global: {
					stubs: { Icon: IconStubComponent, NuxtLink: NuxtLinkStub },
				},
				slots: { default: "<div>Content</div>" },
			});

			expect(wrapper.text()).toContain("退出登录");
			const logoutButton = wrapper.find("button");
			expect(logoutButton.exists()).toBe(true);
		});

		it("calls logout when logout button is clicked", async () => {
			vi.stubGlobal("useRoute", () => ({
				path: "/admin",
				params: {},
				query: {},
			}));

			const { default: AdminLayout } = await import("@/layouts/admin.vue");
			const wrapper = mount(AdminLayout, {
				global: {
					stubs: { Icon: IconStubComponent, NuxtLink: NuxtLinkStub },
				},
				slots: { default: "<div>Content</div>" },
			});

			// Find the logout button by its text content
			const buttons = wrapper.findAll("button");
			const logoutButton = buttons.find((b) => b.text().includes("退出登录"));
			expect(logoutButton).toBeDefined();
			await logoutButton?.trigger("click");

			expect(mockLogout).toHaveBeenCalled();
		});

		it("highlights the active nav item based on current route", async () => {
			vi.stubGlobal("useRoute", () => ({
				path: "/admin/posts",
				params: {},
				query: {},
			}));
			const { default: AdminLayout } = await import("@/layouts/admin.vue");
			const wrapper = mount(AdminLayout, {
				global: {
					stubs: { Icon: IconStubComponent, NuxtLink: NuxtLinkStub },
				},
				slots: { default: "<div>Content</div>" },
			});

			const postsLink = wrapper.find('a[href="/admin/posts"]');
			expect(postsLink.exists()).toBe(true);
			// The active link should have the active background class
			expect(postsLink.classes()).toContain("bg-blue-50");
		});
	});

	describe("Unauthenticated state", () => {
		it("renders login page without sidebar when unauthenticated on login route", async () => {
			mockAuthState.value = false;
			vi.stubGlobal("useRoute", () => ({
				path: "/admin/login",
				params: {},
				query: {},
			}));

			const { default: AdminLayout } = await import("@/layouts/admin.vue");
			const wrapper = mount(AdminLayout, {
				global: {
					stubs: { Icon: IconStubComponent, NuxtLink: NuxtLinkStub },
				},
				slots: { default: '<div class="login-content">Login Form</div>' },
			});

			// Login page content should be rendered
			expect(wrapper.find(".login-content").exists()).toBe(true);
			// Sidebar should NOT be rendered
			expect(wrapper.text()).not.toContain("X-Blog 管理");
		});

		it("redirects to login when unauthenticated on non-login route", async () => {
			mockAuthState.value = false;
			vi.stubGlobal("useRoute", () => ({
				path: "/admin/posts",
				params: {},
				query: {},
			}));

			const mockNavigateTo = vi.fn();
			vi.stubGlobal("navigateTo", mockNavigateTo);

			const { default: AdminLayout } = await import("@/layouts/admin.vue");
			const wrapper = mount(AdminLayout, {
				global: {
					stubs: { Icon: IconStubComponent, NuxtLink: NuxtLinkStub },
				},
				slots: { default: "<div>Content</div>" },
			});

			// The layout should call navigateTo to redirect to login
			expect(mockNavigateTo).toHaveBeenCalledWith("/admin/login", {
				replace: true,
			});
			// Sidebar should NOT be rendered
			expect(wrapper.text()).not.toContain("X-Blog 管理");
			expect(wrapper.text()).not.toContain("仪表盘");
		});
	});
});
