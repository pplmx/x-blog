/**
 * HeaderSearch component tests
 *
 * Verifies the instant-search dropdown: query state, keyboard navigation, and
 * the "View all results" button reaching the full search page for BOTH mouse
 * (mousedown) and keyboard (click via Enter/Space) activation. The button used
 * to bind only @mousedown.prevent — a keyboard user who Tabbed to it and
 * pressed Enter/Space fired a click nobody handled, a dead primary CTA
 * (deep-dive finding ISS-174).
 */

import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import HeaderSearch from "../../components/HeaderSearch.vue";

const mockSearchResponse = {
	items: [
		{
			id: 1,
			title: "Nuxt Guide",
			slug: "nuxt-guide",
			views: 42,
			category: { id: 1, name: "Tech" },
		},
	],
	pagination: { total: 1, page: 1, limit: 5, total_pages: 1 },
};

function mountHeaderSearch() {
	const navigateToMock = vi.fn();

	vi.stubGlobal("useRuntimeConfig", () => ({
		public: { apiUrl: "http://localhost:18888" },
	}));
	vi.stubGlobal("navigateTo", navigateToMock);
	vi.stubGlobal(
		"$fetch",
		vi.fn(async (url: string) => {
			const u = String(url);
			if (u.includes("/api/search")) return mockSearchResponse;
			throw new Error(`Unexpected $fetch in HeaderSearch test: ${u}`);
		}),
	);
	vi.stubGlobal("useLang", () => ({ t: (key: string) => key }));

	const wrapper = mount(HeaderSearch, {
		global: {
			stubs: {
				Icon: {
					template: '<svg class="iconstub" />',
				},
			},
		},
	});

	return { wrapper, navigateToMock };
}

describe("HeaderSearch", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("renders a combobox input", async () => {
		const { wrapper } = mountHeaderSearch();
		const input = wrapper.find('input[role="combobox"]');
		expect(input.exists()).toBe(true);
	});

	it("navigates to the full search page when the view-all button is mouse-clicked", async () => {
		const { wrapper, navigateToMock } = mountHeaderSearch();
		const input = wrapper.find('input[role="combobox"]');
		await input.setValue("nuxt");
		input.trigger("keydown", { key: "ArrowDown" });
		await flushPromises(); // let the debounce + $fetch resolve

		const viewAll = wrapper.find("button");
		expect(viewAll.exists()).toBe(true);
		// Mouse path: mousedown.prevent keeps the popup open, then the click
		// (fired on mouseup) does the navigation.
		await viewAll.trigger("mousedown");
		await viewAll.trigger("click");
		expect(navigateToMock).toHaveBeenCalledWith({ path: "/search", query: { q: "nuxt" } });
		expect(navigateToMock).toHaveBeenCalledTimes(1);
	});

	it("navigates when the view-all button is keyboard-activated via click (Enter/Space)", async () => {
		// Regression: the button previously bound only @mousedown.prevent — a
		// keyboard user's Enter/Space fires a `click` event, which had no
		// handler, so the primary full-search CTA was mouse-only.
		const { wrapper, navigateToMock } = mountHeaderSearch();
		const input = wrapper.find('input[role="combobox"]');
		await input.setValue("nuxt");
		input.trigger("keydown", { key: "ArrowDown" });
		await flushPromises();

		const viewAll = wrapper.find("button");
		await viewAll.trigger("click"); // keyboard activation path
		expect(navigateToMock).toHaveBeenCalledWith({ path: "/search", query: { q: "nuxt" } });
	});
});
