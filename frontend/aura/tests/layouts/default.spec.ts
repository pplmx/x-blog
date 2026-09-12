import { mount } from "@vue/test-utils";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { reactive } from "vue";

import DefaultLayout from "../../app/layouts/default.vue";
import { useTheme } from "../../composables/useTheme";

// The unread badge + poll lifecycle are mocked so tests can drive the badge
// count directly and assert the layout's start/stop-poll wiring (the real
// composable schedules a 60s interval and hits $fetch — not test-friendly).
const badgeMocks = vi.hoisted(() => ({
	startPolling: vi.fn(),
	stopPolling: vi.fn(),
	// The mock factory swaps in a real `ref(0)` before any test runs; this
	// placeholder keeps the type non-optional so tests write `.value` directly.
	unreadCount: { value: 0 } as { value: number },
}));

vi.mock("../../composables/useNotificationBadge", async () => {
	const { ref } = await import("vue");
	const unreadCount = ref(0);
	badgeMocks.unreadCount = unreadCount;
	return {
		useNotificationBadge: () => ({
			unreadCount,
			refresh: vi.fn(),
			startPolling: badgeMocks.startPolling,
			stopPolling: badgeMocks.stopPolling,
		}),
	};
});

// Shared reactive route: mutating it drives path-dependent rendering (isHome
// header treatment, active nav links, route-change menu close) across tests.
const mockRoute = reactive({ path: "/", query: {} as Record<string, unknown> });

beforeAll(() => {
	vi.stubGlobal("useRoute", () => mockRoute);
	vi.stubGlobal("onMounted", (fn: () => void) => fn());
	vi.stubGlobal("onUnmounted", () => {});
	vi.stubGlobal("watch", () => {});
});

beforeEach(() => {
	mockRoute.path = "/";
	if (badgeMocks.unreadCount) badgeMocks.unreadCount.value = 0;
	badgeMocks.startPolling.mockClear();
	badgeMocks.stopPolling.mockClear();
	// Older tests toggle the shared useTheme singleton and persist it; reset to
	// a clean light state so each test's theme assertions start deterministic.
	useTheme().isDark.value = false;
	localStorage.removeItem("theme");
});

function mountLayout() {
	return mount(DefaultLayout, {
		slots: {
			default: '<div class="page-content">Page content here</div>',
		},
		global: {
			stubs: {
				NuxtLink: {
					template: '<a :href="to"><slot/></a>',
					props: ["to"],
				},
				Icon: {
					template: '<svg class="iconstub" data-icon=":icon"></svg>',
					props: ["icon"],
				},
				// Nuxt auto-import is not active in vitest; the fixed 429 banner
				// resolves through this stub in tests.
				RateLimitNotice: {
					template: '<div class="rate-limit-stub" />',
				},
			},
		},
	});
}

describe("Default Layout", () => {
	describe("Header", () => {
		it("renders the X-Blog brand name", () => {
			const wrapper = mountLayout();
			expect(wrapper.text()).toContain("X-Blog");
		});

		it("renders navigation links", () => {
			const wrapper = mountLayout();
			const homeLink = wrapper.findAll('a[href="/"]');
			expect(homeLink.length).toBeGreaterThanOrEqual(1);
		});

		it("renders a link to the about page", () => {
			const wrapper = mountLayout();
			const aboutLink = wrapper.find('a[href="/about"]');
			expect(aboutLink.exists()).toBe(true);
		});
	});

	describe("Slot", () => {
		it("renders slot content in the main area", () => {
			const wrapper = mountLayout();
			expect(wrapper.text()).toContain("Page content here");
			const mainContent = wrapper.find(".page-content");
			expect(mainContent.exists()).toBe(true);
		});

		it("renders the main element", () => {
			const wrapper = mountLayout();
			expect(wrapper.find("main").exists()).toBe(true);
		});
	});

	describe("Footer", () => {
		it("renders the footer", () => {
			const wrapper = mountLayout();
			expect(wrapper.find("footer").exists()).toBe(true);
		});

		it("renders the 'Made with' text", () => {
			const wrapper = mountLayout();
			expect(wrapper.text()).toMatch(/用/);
		});

		it("renders the 'for developers' text", () => {
			const wrapper = mountLayout();
			expect(wrapper.text()).toMatch(/为开发者打造/);
		});

		it("renders an RSS subscribe link to the feed", () => {
			const wrapper = mountLayout();
			const rssLink = wrapper.find('a[href="/rss/feed.xml"]');
			expect(rssLink.exists()).toBe(true);
			expect(rssLink.attributes("type")).toBe("application/rss+xml");
		});
	});

	describe("Structure", () => {
		it("renders header, main, and footer elements", () => {
			const wrapper = mountLayout();
			expect(wrapper.find("header").exists()).toBe(true);
			expect(wrapper.find("main").exists()).toBe(true);
			expect(wrapper.find("footer").exists()).toBe(true);
		});
	});

	describe("Dark mode", () => {
		it("renders dark mode toggle button", () => {
			const wrapper = mountLayout();
			const toggle = wrapper.find('button[aria-label*="模式"]');
			expect(toggle.exists()).toBe(true);
		});

		it("toggles dark mode when button is clicked", async () => {
			const wrapper = mountLayout();
			const toggle = wrapper.find("button");
			expect(toggle.exists()).toBe(true);
			// Just verify it doesn't crash
			await toggle.trigger("click");
			expect(wrapper.exists()).toBe(true);
		});
	});

	describe("Mobile menu", () => {
		it("renders mobile menu button", () => {
			const wrapper = mountLayout();
			const menuButton = wrapper.find("button");
			expect(menuButton.exists()).toBe(true);
		});

		it("opens mobile menu when menu button is clicked", async () => {
			const wrapper = mountLayout();
			const menuButton = wrapper.find('button[aria-label="打开菜单"]');
			expect(menuButton.exists()).toBe(true);

			await menuButton.trigger("click");
			await wrapper.vm.$nextTick();

			// The mobile nav panel should exist (desktop nav renders Home too)
			expect(wrapper.find("#mobile-nav").exists()).toBe(true);
		});

		it("closes the mobile menu on Escape (ISS-131)", async () => {
			const wrapper = mountLayout();
			const menuButton = wrapper.find('button[aria-label="打开菜单"]');
			await menuButton.trigger("click");
			await wrapper.vm.$nextTick();
			expect(wrapper.find("#mobile-nav").exists()).toBe(true);

			window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
			await wrapper.vm.$nextTick();

			expect(wrapper.find("#mobile-nav").exists()).toBe(false);
			expect(menuButton.attributes("aria-expanded")).toBe("false");
		});
	});

	describe("Mobile menu keyboard focus (ISS-131)", () => {
		// These assert real focus movement, so the layout must be attached to
		// the DOM (the non-attached mountLayout() leaves focus tracking inert).
		afterEach(() => {
			document.body.innerHTML = "";
		});

		function mountAttached() {
			return mount(DefaultLayout, {
				slots: {
					default: '<div class="page-content">Page content here</div>',
				},
				attachTo: document.body,
				global: {
					stubs: {
						NuxtLink: {
							template: '<a :href="to"><slot/></a>',
							props: ["to"],
						},
						Icon: {
							template: '<svg class="iconstub" data-icon=":icon"></svg>',
							props: ["icon"],
						},
					},
				},
			});
		}

		it("moves focus into the menu on open and restores it to the toggle on Escape", async () => {
			const wrapper = mountAttached();
			const menuButton = wrapper.find('button[aria-label="打开菜单"]');
			await menuButton.trigger("click");
			await wrapper.vm.$nextTick();
			expect(document.activeElement).toBe(wrapper.find("#mobile-nav a").element);

			window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
			await wrapper.vm.$nextTick();
			expect(document.activeElement).toBe(menuButton.element);
		});
	});

	describe("Reader account nav (TASK-133)", () => {
		it("renders a bookmarks nav link", () => {
			const wrapper = mountLayout();
			const bookmarks = wrapper.find('a[href="/bookmarks"]');
			expect(bookmarks.exists()).toBe(true);
		});

		it("shows sign-in link when unauthenticated", () => {
			const wrapper = mountLayout();
			const signIn = wrapper.find('a[href="/login"]');
			expect(signIn.exists()).toBe(true);
			expect(signIn.text()).toContain("登录");
		});

		it("shows sign-out instead of sign-in when a reader token exists", async () => {
			// useReaderAuth() re-reads localStorage on every call, so planting the
			// token before mount flips the layout into the authenticated state.
			localStorage.setItem("reader_token", "jwt.token");

			const wrapper = mountLayout();
			// Desktop: sign-in link gone, sign-out button present.
			expect(wrapper.find('a[href="/login"]').exists()).toBe(false);
			expect(wrapper.text()).toContain("退出登录");

			// Mobile menu also exposes sign-out.
			const menuButton = wrapper.find('button[aria-label="打开菜单"]');
			await menuButton.trigger("click");
			await wrapper.vm.$nextTick();
			expect(wrapper.text()).toContain("退出登录");

			localStorage.removeItem("reader_token");
		});
	});

	describe("Route-aware header", () => {
		it("uses the non-home header treatment and lights the active nav link off the home page", async () => {
			mockRoute.path = "/about";
			const wrapper = mountLayout();

			const header = wrapper.find("header");
			expect(header.classes().some((c) => c.includes("bg-white/90"))).toBe(true);

			const aboutLink = wrapper.findAll('a[href="/about"]').find((a) => a.text().includes("关于"));
			expect(aboutLink).toBeDefined();
			expect(aboutLink?.classes().some((c) => c.includes("text-blue-600"))).toBe(true);

			// The home link is NOT active on /about.
			const homeLink = wrapper.findAll('a[href="/"]').find((a) => a.text().includes("首页"));
			expect(homeLink).toBeDefined();
			expect(homeLink?.classes().some((c) => c.includes("text-blue-600"))).toBe(false);
		});

		it("closes the mobile menu when the route changes", async () => {
			const wrapper = mountLayout();
			const menuButton = wrapper.find('button[aria-label="打开菜单"]');
			await menuButton.trigger("click");
			await wrapper.vm.$nextTick();
			expect(wrapper.find("#mobile-nav").exists()).toBe(true);

			mockRoute.path = "/about";
			await wrapper.vm.$nextTick();
			expect(wrapper.find("#mobile-nav").exists()).toBe(false);
		});
	});

	describe("Unread notification badge", () => {
		it("shows the unread count on the notifications nav item when signed in", async () => {
			localStorage.setItem("reader_token", "jwt.token");
			badgeMocks.unreadCount.value = 5;
			const wrapper = mountLayout();

			const badge = wrapper.find('a[href="/notifications"] [role="status"]');
			expect(badge.exists()).toBe(true);
			expect(badge.text()).toBe("5");

			localStorage.removeItem("reader_token");
		});

		it("caps the unread count at 99+", async () => {
			localStorage.setItem("reader_token", "jwt.token");
			badgeMocks.unreadCount.value = 150;
			const wrapper = mountLayout();

			expect(wrapper.find('a[href="/notifications"] [role="status"]').text()).toBe("99+");

			localStorage.removeItem("reader_token");
		});

		it("renders no badge when the unread count is zero", async () => {
			localStorage.setItem("reader_token", "jwt.token");
			badgeMocks.unreadCount.value = 0;
			const wrapper = mountLayout();

			expect(wrapper.find('a[href="/notifications"] [role="status"]').exists()).toBe(false);

			localStorage.removeItem("reader_token");
		});

		it("shows the unread badge inside the mobile menu too", async () => {
			localStorage.setItem("reader_token", "jwt.token");
			badgeMocks.unreadCount.value = 5;
			const wrapper = mountLayout();

			const menuButton = wrapper.find('button[aria-label="打开菜单"]');
			await menuButton.trigger("click");
			await wrapper.vm.$nextTick();

			const mobileBadges = wrapper.findAll("#mobile-nav [role='status']");
			expect(mobileBadges.length).toBeGreaterThan(0);
			expect(mobileBadges[0].text()).toBe("5");

			localStorage.removeItem("reader_token");
		});

		it("caps the mobile unread badge at 99+ too", async () => {
			localStorage.setItem("reader_token", "jwt.token");
			badgeMocks.unreadCount.value = 150;
			const wrapper = mountLayout();

			const menuButton = wrapper.find('button[aria-label="打开菜单"]');
			await menuButton.trigger("click");
			await wrapper.vm.$nextTick();

			const mobileBadges = wrapper.findAll("#mobile-nav [role='status']");
			expect(mobileBadges.length).toBeGreaterThan(0);
			expect(mobileBadges[0].text()).toBe("99+");

			localStorage.removeItem("reader_token");
		});
	});

	describe("Mobile menu interactions", () => {
		it("closes the menu when the toggle is clicked again", async () => {
			const wrapper = mountLayout();
			const menuButton = wrapper.find('button[aria-label="打开菜单"]');
			await menuButton.trigger("click");
			await wrapper.vm.$nextTick();
			expect(wrapper.find("#mobile-nav").exists()).toBe(true);

			await menuButton.trigger("click");
			await wrapper.vm.$nextTick();
			expect(wrapper.find("#mobile-nav").exists()).toBe(false);
		});

		it("closes the menu when a nav link is clicked", async () => {
			const wrapper = mountLayout();
			const menuButton = wrapper.find('button[aria-label="打开菜单"]');
			await menuButton.trigger("click");
			await wrapper.vm.$nextTick();

			const aboutLink = wrapper.find('#mobile-nav a[href="/about"]');
			expect(aboutLink.exists()).toBe(true);
			await aboutLink.trigger("click");
			await wrapper.vm.$nextTick();
			expect(wrapper.find("#mobile-nav").exists()).toBe(false);
		});

		it("closes the menu from the guest sign-in link", async () => {
			const wrapper = mountLayout();
			const menuButton = wrapper.find('button[aria-label="打开菜单"]');
			await menuButton.trigger("click");
			await wrapper.vm.$nextTick();

			const signIn = wrapper.find('#mobile-nav a[href="/login"]');
			expect(signIn.exists()).toBe(true);
			await signIn.trigger("click");
			await wrapper.vm.$nextTick();
			expect(wrapper.find("#mobile-nav").exists()).toBe(false);
		});

		it("signs out from the mobile menu", async () => {
			localStorage.setItem("reader_token", "jwt.token");
			const wrapper = mountLayout();

			const menuButton = wrapper.find('button[aria-label="打开菜单"]');
			await menuButton.trigger("click");
			await wrapper.vm.$nextTick();

			const signOut = wrapper
				.findAll("#mobile-nav button")
				.find((b) => b.text().includes("退出登录"));
			expect(signOut).toBeDefined();
			await signOut?.trigger("click");
			await wrapper.vm.$nextTick();

			expect(localStorage.getItem("reader_token")).toBeNull();
			localStorage.removeItem("reader_token");
		});
	});

	describe("Dark mode", () => {
		it("toggles dark mode from the desktop theme button", async () => {
			const wrapper = mountLayout();
			const toggle = wrapper
				.findAll("button")
				.find(
					(b) =>
						b.attributes("aria-label") === "切换到深色模式" ||
						b.attributes("aria-label") === "切换到浅色模式",
				);
			expect(toggle).toBeDefined();
			expect(toggle?.attributes("aria-label")).toBe("切换到深色模式");

			await toggle?.trigger("click");
			await wrapper.vm.$nextTick();
			expect(toggle?.attributes("aria-label")).toBe("切换到浅色模式");

			// Reset the shared useTheme singleton back to light.
			useTheme().isDark.value = false;
			localStorage.removeItem("theme");
		});

		it("toggles dark mode from the mobile menu theme control", async () => {
			const wrapper = mountLayout();
			const menuButton = wrapper.find('button[aria-label="打开菜单"]');
			await menuButton.trigger("click");
			await wrapper.vm.$nextTick();

			const toggle = wrapper.findAll("#mobile-nav button").at(-1);
			expect(toggle).toBeDefined();
			expect(toggle?.text()).toContain("深色模式");
			await toggle?.trigger("click");
			await wrapper.vm.$nextTick();
			expect(toggle?.text()).toContain("浅色模式");

			useTheme().isDark.value = false;
			localStorage.removeItem("theme");
		});
	});

	describe("Reader sign-out wiring", () => {
		it("signs out from the desktop nav and restores the sign-in link", async () => {
			localStorage.setItem("reader_token", "jwt.token");
			const wrapper = mountLayout();
			expect(wrapper.find('a[href="/login"]').exists()).toBe(false);

			const signOut = wrapper.findAll("button").find((b) => b.text().includes("退出登录"));
			expect(signOut).toBeDefined();
			await signOut?.trigger("click");
			await wrapper.vm.$nextTick();

			expect(localStorage.getItem("reader_token")).toBeNull();
			expect(wrapper.find('a[href="/login"]').exists()).toBe(true);

			localStorage.removeItem("reader_token");
		});

		it("starts polling while signed in and stops it on sign-out and unmount", async () => {
			localStorage.setItem("reader_token", "jwt.token");
			const removeSpy = vi.spyOn(window, "removeEventListener");

			const wrapper = mountLayout();
			// Authenticated mount → the poll starts.
			expect(badgeMocks.startPolling).toHaveBeenCalled();
			expect(badgeMocks.stopPolling).not.toHaveBeenCalled();

			// Sign-out flips auth to false → the auth watch stops the poll.
			const signOut = wrapper.findAll("button").find((b) => b.text().includes("退出登录"));
			await signOut?.trigger("click");
			await wrapper.vm.$nextTick();
			expect(badgeMocks.stopPolling).toHaveBeenCalled();

			// Unmount tears the layout down: stop polling + drop global listeners.
			wrapper.unmount();
			expect(badgeMocks.stopPolling).toHaveBeenCalled();
			expect(removeSpy).toHaveBeenCalledWith("keydown", expect.any(Function));

			removeSpy.mockRestore();
			localStorage.removeItem("reader_token");
		});
	});

	describe("Auth-aware nav", () => {
		it("hides auth-only nav links (follows/notifications/account) for guests", () => {
			const wrapper = mountLayout();
			expect(wrapper.find('a[href="/follows"]').exists()).toBe(false);
			expect(wrapper.find('a[href="/notifications"]').exists()).toBe(false);
			expect(wrapper.find('a[href="/account"]').exists()).toBe(false);
		});

		it("shows auth-only nav links for signed-in readers", () => {
			localStorage.setItem("reader_token", "jwt.token");
			const wrapper = mountLayout();
			expect(wrapper.find('a[href="/follows"]').exists()).toBe(true);
			expect(wrapper.find('a[href="/notifications"]').exists()).toBe(true);
			expect(wrapper.find('a[href="/account"]').exists()).toBe(true);
			localStorage.removeItem("reader_token");
		});
	});
});
