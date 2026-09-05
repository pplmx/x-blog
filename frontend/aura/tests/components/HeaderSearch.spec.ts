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

function mountHeaderSearch(fetchImpl?: (url: string) => unknown) {
	const navigateToMock = vi.fn();

	vi.stubGlobal("useRuntimeConfig", () => ({
		public: { apiUrl: "http://localhost:18888" },
	}));
	vi.stubGlobal("navigateTo", navigateToMock);
	const searchFetch =
		fetchImpl ??
		vi.fn(async (url: string) => {
			const u = String(url);
			if (u.includes("/api/search")) return mockSearchResponse;
			throw new Error(`Unexpected $fetch in HeaderSearch test: ${u}`);
		});
	vi.stubGlobal("$fetch", searchFetch);
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

	it("labels the input for the global '/' shortcut and shows a kbd hint chip while empty & unfocused", async () => {
		const { wrapper } = mountHeaderSearch();
		const input = wrapper.find('input[role="combobox"]');
		// The composables/useSearchShortcut.ts handler locates inputs by this
		// attribute; the reader layout installs the global keydown listener.
		expect(input.attributes("data-header-search")).toBeDefined();
		// Empty + not focused → the "/" chip advertises the shortcut…
		expect(wrapper.find("kbd").exists()).toBe(true);
		expect(wrapper.find("kbd").text()).toBe("/");
		// …typing hides it (it only advertises the shortcut, no signal value).
		await input.setValue("nuxt");
		expect(wrapper.find("kbd").exists()).toBe(false);
	});

	it("hides the kbd chip on focus and shows the type-to-search hint in the empty dropdown", async () => {
		const { wrapper } = mountHeaderSearch();
		const input = wrapper.find('input[role="combobox"]');
		await input.trigger("focus");
		// Focused empty box: the "/" chip gives way (the reader is already
		// inside the search), and the dropdown explains itself instead of a
		// bare "View all results" affordance (headerSearch.hint was dead).
		expect(wrapper.find("kbd").exists()).toBe(false);
		expect(wrapper.find('[data-testid="header-search-hint"]').exists()).toBe(true);
		// The "View all results" affordance is still offered alongside the hint
		// (its navigation behavior is covered by the dedicated tests below).
		expect(wrapper.find("button").exists()).toBe(true);
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

	it("renders matching results once the debounced search settles", async () => {
		// Locks the transport → results path: `command` (transport.ts) resolves
		// via $fetch through the mock, and the debounced timer is advanced by
		// hand — the older tests only ever exercised the synchronous dropdown
		// open + view-all navigation, never an actual settled search.
		vi.useFakeTimers();
		const { wrapper } = mountHeaderSearch();
		const input = wrapper.find('input[role="combobox"]');
		await input.setValue("nuxt");
		await vi.advanceTimersByTimeAsync(300); // fire the debounce
		await flushPromises();
		vi.useRealTimers();

		expect(wrapper.findAll("li").length).toBe(1);
		expect(wrapper.text()).toContain("Nuxt Guide");
		expect(wrapper.find(".text-red-600").exists()).toBe(false);
	});

	it("shows a failure notice — not 'no matches' — when the search request errors", async () => {
		// Regression (ISS-309): the search used a raw $fetch that bypassed the
		// transport's 429 detector, so a rate-limited search-as-you-type read as
		// an empty dead end ("No matching posts") instead of an error.
		// The component debounces via setTimeout(300) — flushPromises alone never
		// advances a real timer, so the running search must be driven by fake
		// timers. `command` in transport.ts calls $fetch, so a rejecting $fetch
		// propagates through the seam into the component's catch.
		vi.useFakeTimers();
		const { wrapper } = mountHeaderSearch(() => {
			throw new Error("rate limited");
		});
		const input = wrapper.find('input[role="combobox"]');
		await input.setValue("nuxt");
		await vi.advanceTimersByTimeAsync(300); // let the debounce fire
		await flushPromises();
		vi.useRealTimers();

		// The red failure notice renders…
		expect(wrapper.find(".text-red-600").exists()).toBe(true);
		// …no options are shown…
		expect(wrapper.findAll("li").length).toBe(0);
		// …and the gray "no matches" state is NOT rendered (neither visible nor
		// live-region text lies about the error).
		expect(wrapper.find(".text-gray-500").exists()).toBe(false);
	});
});
