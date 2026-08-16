/**
 * App root component tests
 * Tests the root app.vue: renders NuxtLayout with NuxtPage inside.
 * Stubs NuxtLayout and NuxtPage components.
 */

import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

import App from "../app/app.vue";

// app.vue syncs <html lang> via useHead; stub it so mounting doesn't throw.
beforeEach(() => {
	vi.stubGlobal("useHead", vi.fn());
});

function mountApp() {
	return mount(App, {
		global: {
			stubs: {
				NuxtLayout: {
					template: '<div class="nuxt-layout"><slot/></div>',
				},
				NuxtPage: {
					template: '<div class="nuxt-page">Page content</div>',
				},
			},
		},
	});
}

describe("App Root", () => {
	describe("Rendering", () => {
		it("renders without errors", () => {
			const wrapper = mountApp();
			expect(wrapper.exists()).toBe(true);
		});

		it("renders the NuxtLayout wrapper", () => {
			const wrapper = mountApp();
			expect(wrapper.find(".nuxt-layout").exists()).toBe(true);
		});

		it("renders the NuxtPage inside the layout", () => {
			const wrapper = mountApp();
			expect(wrapper.find(".nuxt-page").exists()).toBe(true);
			expect(wrapper.text()).toContain("Page content");
		});
	});

	describe("Feed auto-discovery", () => {
		it("emits RSS and Atom alternate link tags via useHead", () => {
			mountApp();
			const calls = vi.mocked(useHead).mock.calls;
			const linkArgs = calls.flatMap(([arg]) =>
				arg && Array.isArray((arg as Record<string, unknown>).link)
					? ((arg as Record<string, unknown>).link as Array<Record<string, string>>)
					: [],
			);
			const rss = linkArgs.find((l) => l.href === "/rss/feed.xml");
			const atom = linkArgs.find((l) => l.href === "/rss/atom.xml");
			expect(rss).toBeTruthy();
			expect(rss?.type).toBe("application/rss+xml");
			expect(rss?.rel).toBe("alternate");
			expect(atom).toBeTruthy();
			expect(atom?.type).toBe("application/atom+xml");
		});
	});
});
