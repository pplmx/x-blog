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

	it("does not repopulate stale results after the query is cleared mid-flight (round 278)", async () => {
		// Clearing the box while a previous keystroke's search is in flight must
		// invalidate it: the empty branch used to leave requestSeq untouched, so
		// the slow response resolved with seq === requestSeq and committed
		// results under an already-empty input — a reader could click a
		// "result" that had nothing to do with the box.
		vi.useFakeTimers();
		let resolveSearch!: (v: unknown) => void;
		const { wrapper } = mountHeaderSearch(
			() =>
				new Promise((res) => {
					resolveSearch = res;
				}),
		);
		const input = wrapper.find('input[role="combobox"]');
		await input.setValue("fast");
		await vi.advanceTimersByTimeAsync(300); // debounce fires; request hangs
		await flushPromises();

		// Clear the query while the search is still in flight…
		await input.setValue("");
		await flushPromises();
		expect(wrapper.findAll("li").length).toBe(0);

		// …the stale response must NOT repopulate the dropdown.
		resolveSearch(mockSearchResponse);
		await flushPromises();
		expect(wrapper.findAll("li").length).toBe(0);
		expect(wrapper.text()).not.toContain("Nuxt Guide");
		vi.useRealTimers();
	});

	it("debounces: no request fires until the 300ms window has elapsed", async () => {
		vi.useFakeTimers();
		const fetchSpy = vi.fn(async () => mockSearchResponse);
		const { wrapper } = mountHeaderSearch(fetchSpy);
		const input = wrapper.find('input[role="combobox"]');

		await input.setValue("nuxt");
		await flushPromises();
		expect(fetchSpy).not.toHaveBeenCalled();

		// Just short of the window — the request must NOT have fired yet.
		await vi.advanceTimersByTimeAsync(299);
		await flushPromises();
		expect(fetchSpy).not.toHaveBeenCalled();

		// Crossing the boundary fires exactly one search.
		await vi.advanceTimersByTimeAsync(1);
		await flushPromises();
		expect(fetchSpy).toHaveBeenCalledTimes(1);
		vi.useRealTimers();
	});

	it("supports ArrowDown/ArrowUp through the results and selects one with Enter", async () => {
		vi.useFakeTimers();
		const twoResults = {
			items: [
				mockSearchResponse.items[0],
				{
					id: 2,
					title: "Vue Router Deep Dive",
					slug: "vue-router",
					views: 7,
					category: { id: 2, name: "Frontend" },
				},
			],
			pagination: { total: 2, page: 1, limit: 5, total_pages: 1 },
		};
		const { wrapper, navigateToMock } = mountHeaderSearch(() => Promise.resolve(twoResults));
		const input = wrapper.find('input[role="combobox"]');
		await input.setValue("vue");
		await vi.advanceTimersByTimeAsync(300);
		await flushPromises();
		expect(wrapper.findAll("li").length).toBe(2);

		// ArrowDown activates the first option and announces it via the
		// combobox's aria-activedescendant; the active class is applied.
		await input.trigger("keydown", { key: "ArrowDown" });
		expect(input.attributes("aria-activedescendant")).toBe("header-search-option-0");
		expect(
			wrapper
				.findAll("li")[0]
				.classes()
				.some((c) => c.includes("bg-gray-50")),
		).toBe(true);

		// A second ArrowDown moves to the next option.
		await input.trigger("keydown", { key: "ArrowDown" });
		expect(input.attributes("aria-activedescendant")).toBe("header-search-option-1");
		expect(
			wrapper
				.findAll("li")[1]
				.classes()
				.some((c) => c.includes("bg-gray-50")),
		).toBe(true);

		// ArrowUp wraps back to the first option.
		await input.trigger("keydown", { key: "ArrowUp" });
		expect(input.attributes("aria-activedescendant")).toBe("header-search-option-0");

		// Mouse hover also drives the highlight (mouseenter).
		await wrapper.findAll("li")[1].trigger("mouseenter");
		expect(input.attributes("aria-activedescendant")).toBe("header-search-option-1");

		// Enter picks the highlighted option → navigates to that post and the
		// dropdown unmounts.
		await input.trigger("keydown", { key: "Enter" });
		expect(navigateToMock).toHaveBeenCalledWith("/posts/vue-router");
		expect(wrapper.find("ul").exists()).toBe(false);
		vi.useRealTimers();
	});

	it("Enter without a highlighted result falls back to the full search page", async () => {
		vi.useFakeTimers();
		const { wrapper, navigateToMock } = mountHeaderSearch();
		const input = wrapper.find('input[role="combobox"]');
		await input.setValue("nuxt");
		await vi.advanceTimersByTimeAsync(300);
		await flushPromises();
		expect(wrapper.findAll("li").length).toBe(1);

		// No arrow press → activeIndex stays -1, so Enter goes to /search.
		await input.trigger("keydown", { key: "Enter" });
		expect(navigateToMock).toHaveBeenCalledWith({ path: "/search", query: { q: "nuxt" } });
		vi.useRealTimers();
	});

	it("closes the dropdown when Escape is pressed while it is open", async () => {
		vi.useFakeTimers();
		const { wrapper } = mountHeaderSearch();
		const input = wrapper.find('input[role="combobox"]');
		await input.setValue("nuxt"); // opens the dropdown (open=true) + arms the debounce
		expect(wrapper.find("ul").exists()).toBe(true); // dropdown open, still settling

		// Escape mid-settle closes the dropdown AND cancels the pending debounce
		// so the settled results never repopulate it.
		await input.trigger("keydown", { key: "Escape" });
		expect(wrapper.find("ul").exists()).toBe(false);
		await vi.advanceTimersByTimeAsync(400);
		await flushPromises();
		expect(wrapper.find("ul").exists()).toBe(false);
		vi.useRealTimers();
	});

	it("clears the stuck loading spinner when the dropdown closes mid-search and reopens (round 295)", async () => {
		// Closing the dropdown (Escape / blur / picking a result) invalidates the
		// in-flight request via requestSeq; the request's finally then bails
		// WITHOUT clearing `loading`, so reopening used to show an eternal spinner
		// and zero results until the reader typed a new query.
		vi.useFakeTimers();
		let resolveSearch!: (v: unknown) => void;
		const { wrapper } = mountHeaderSearch(
			() =>
				new Promise((res) => {
					resolveSearch = res;
				}),
		);
		const input = wrapper.find('input[role="combobox"]');
		await input.setValue("fast");
		await vi.advanceTimersByTimeAsync(300); // debounce fires; request hangs
		await flushPromises();

		// The spinner is showing while the request is in flight…
		expect(wrapper.find("div.absolute.right-3").exists()).toBe(true);

		// …Escape closes the dropdown AND must reset `loading`…
		await input.trigger("keydown", { key: "Escape" });
		expect(wrapper.find("ul").exists()).toBe(false);
		expect(wrapper.find("div.absolute.right-3").exists()).toBe(false);

		// …so refocus reopens a clean dropdown (no phantom spinner) even though
		// the stale in-flight response never resolves.
		await input.trigger("focus");
		expect(wrapper.find("ul").exists()).toBe(true);
		expect(wrapper.find("div.absolute.right-3").exists()).toBe(false);
		expect(wrapper.find('[data-testid="header-search-hint"]').exists()).toBe(false); // query non-empty

		resolveSearch(mockSearchResponse); // drain the hung request
		await flushPromises();
		vi.useRealTimers();
	});

	it("is a no-op when Escape is pressed with no open dropdown", async () => {
		const { wrapper } = mountHeaderSearch();
		const input = wrapper.find('input[role="combobox"]');
		await input.trigger("keydown", { key: "Escape" });
		expect(wrapper.find("ul").exists()).toBe(false);
	});

	it("navigates to the plain /search page when view-all is used with an empty query", async () => {
		const { wrapper, navigateToMock } = mountHeaderSearch();
		const input = wrapper.find('input[role="combobox"]');
		// Focus (no query typed) opens the empty dropdown with the hint.
		await input.trigger("focus");
		const viewAll = wrapper.find("button");
		expect(viewAll.exists()).toBe(true);

		await viewAll.trigger("mousedown");
		await viewAll.trigger("click");
		expect(navigateToMock).toHaveBeenCalledWith("/search");
	});

	it("navigates to the post when a result row is mouse-clicked", async () => {
		vi.useFakeTimers();
		const { wrapper, navigateToMock } = mountHeaderSearch();
		const input = wrapper.find('input[role="combobox"]');
		await input.setValue("nuxt");
		await vi.advanceTimersByTimeAsync(300);
		await flushPromises();

		const li = wrapper.find("li");
		// mousedown.prevent binds pick() so the click inside the popup lands
		// before blur would unmount it.
		await li.trigger("mousedown");
		expect(navigateToMock).toHaveBeenCalledWith("/posts/nuxt-guide");
		expect(wrapper.find("ul").exists()).toBe(false);
		vi.useRealTimers();
	});

	it("shows the zero-results notice for a settled search with no matches", async () => {
		vi.useFakeTimers();
		const { wrapper } = mountHeaderSearch(() =>
			Promise.resolve({ items: [], pagination: { total: 0, page: 1, limit: 5, total_pages: 0 } }),
		);
		const input = wrapper.find('input[role="combobox"]');
		await input.setValue("nothing");
		await vi.advanceTimersByTimeAsync(300);
		await flushPromises();

		expect(wrapper.findAll("li").length).toBe(0);
		const noResults = wrapper.find(".text-gray-500");
		expect(noResults.exists()).toBe(true);
		expect(noResults.text()).toContain("未找到匹配的文章");
		vi.useRealTimers();
	});

	it("renders a result whose category is null without crashing (empty fallback)", async () => {
		vi.useFakeTimers();
		const { wrapper } = mountHeaderSearch(() =>
			Promise.resolve({
				items: [{ id: 2, title: "Untagged", slug: "untagged", views: 7, category: null }],
				pagination: { total: 1, page: 1, limit: 5, total_pages: 1 },
			}),
		);
		const input = wrapper.find('input[role="combobox"]');
		await input.setValue("untagged");
		await vi.advanceTimersByTimeAsync(300);
		await flushPromises();

		const li = wrapper.find("li");
		expect(li.exists()).toBe(true);
		expect(li.text()).toContain("7");
		vi.useRealTimers();
	});

	it("closes the dropdown shortly after the input loses focus", async () => {
		vi.useFakeTimers();
		const { wrapper } = mountHeaderSearch();
		const input = wrapper.find('input[role="combobox"]');
		await input.setValue("nuxt");
		expect(wrapper.find("ul").exists()).toBe(true); // dropdown open while settling

		// Blur arms a 150ms delayed close (so a click inside the popup can land);
		// advancing past it must close the dropdown for good.
		await input.trigger("blur");
		await vi.advanceTimersByTimeAsync(160);
		await flushPromises();
		expect(wrapper.find("ul").exists()).toBe(false);
		vi.useRealTimers();
	});

	it("ignores a failed search that was superseded by a newer keystroke", async () => {
		vi.useFakeTimers();
		const pending: Array<{ resolve: (v: unknown) => void; reject: (e: unknown) => void }> = [];
		const fetchImpl = vi.fn(
			(url: string) =>
				new Promise<unknown>((resolve, reject) => {
					void url;
					pending.push({ resolve, reject });
				}),
		);
		const { wrapper } = mountHeaderSearch(fetchImpl);

		const input = wrapper.find('input[role="combobox"]');
		await input.setValue("a");
		await vi.advanceTimersByTimeAsync(300); // search #1 hangs
		await flushPromises();

		await input.setValue("ab");
		await vi.advanceTimersByTimeAsync(300); // search #2 hangs, requestSeq bumped
		await flushPromises();
		expect(pending.length).toBe(2);

		// #1 rejects AFTER #2 started — the stale catch must discard it: no
		// failure banner over a newer in-flight query.
		pending[0].reject(new Error("boom"));
		await flushPromises();
		expect(wrapper.find(".text-red-600").exists()).toBe(false);

		// #2 resolves normally and its results win.
		pending[1].resolve(mockSearchResponse);
		await flushPromises();
		expect(wrapper.findAll("li").length).toBe(1);
		vi.useRealTimers();
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
