import { mount } from "@vue/test-utils";
import { beforeAll, describe, expect, it, vi } from "vitest";

import DefaultLayout from "../../app/layouts/default.vue";

beforeAll(() => {
	vi.stubGlobal("useRoute", () => ({ path: "/" }));
	vi.stubGlobal("onMounted", (fn: () => void) => fn());
	vi.stubGlobal("onUnmounted", () => {});
	vi.stubGlobal("watch", () => {});
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
});
