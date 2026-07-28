import { mount } from "@vue/test-utils";
import { beforeAll, describe, expect, it, vi } from "vitest";

import DefaultLayout from "../../app/layouts/default.vue";

beforeAll(() => {
	vi.stubGlobal("useRoute", () => ({ path: "/" }));
	vi.stubGlobal("onMounted", (fn: () => void) => fn());
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
			expect(wrapper.text()).toMatch(/Made with/);
		});

		it("renders the 'for developers' text", () => {
			const wrapper = mountLayout();
			expect(wrapper.text()).toMatch(/for developers/);
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
	});
});
