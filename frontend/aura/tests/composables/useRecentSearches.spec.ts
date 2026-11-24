/**
 * useRecentSearches tests.
 *
 * The landing page remembers the last few terms per device. Storage is
 * untrusted input: hand-edited JSON, non-string entries and blank terms must
 * all degrade to a usable list instead of breaking the search page.
 */

import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it } from "vite-plus/test";
import { defineComponent, nextTick } from "vue";
import {
	MAX_RECENT_SEARCHES,
	RECENT_SEARCHES_KEY,
	clearRecentSearches,
	readRecentSearches,
	rememberSearchTerm,
	useRecentSearches,
} from "../../composables/useRecentSearches";

beforeEach(() => {
	window.localStorage.clear();
});

describe("readRecentSearches", () => {
	it("returns an empty list when nothing is stored", () => {
		expect(readRecentSearches()).toEqual([]);
	});

	it("drops non-strings and blank terms", () => {
		window.localStorage.setItem(
			RECENT_SEARCHES_KEY,
			JSON.stringify(["fastapi", 42, null, "   ", "nuxt"]),
		);
		expect(readRecentSearches()).toEqual(["fastapi", "nuxt"]);
	});

	it("survives corrupt JSON and non-array payloads", () => {
		window.localStorage.setItem(RECENT_SEARCHES_KEY, "{not json");
		expect(readRecentSearches()).toEqual([]);
		window.localStorage.setItem(RECENT_SEARCHES_KEY, '{"term":"fastapi"}');
		expect(readRecentSearches()).toEqual([]);
	});

	it("caps a hand-written list at the maximum", () => {
		const many = Array.from({ length: MAX_RECENT_SEARCHES + 3 }, (_, i) => `term-${i}`);
		window.localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(many));
		expect(readRecentSearches()).toHaveLength(MAX_RECENT_SEARCHES);
	});
});

describe("rememberSearchTerm", () => {
	it("prepends, trims and persists the term", () => {
		rememberSearchTerm("  fastapi  ");
		rememberSearchTerm("nuxt");
		expect(readRecentSearches()).toEqual(["nuxt", "fastapi"]);
	});

	it("dedupes case-insensitively and promotes the new spelling", () => {
		rememberSearchTerm("FastAPI");
		rememberSearchTerm("nuxt");
		rememberSearchTerm("fastapi");
		expect(readRecentSearches()).toEqual(["fastapi", "nuxt"]);
	});

	it("caps the list, dropping the oldest term", () => {
		for (let i = 0; i < MAX_RECENT_SEARCHES + 2; i++) rememberSearchTerm(`term-${i}`);
		const stored = readRecentSearches();
		expect(stored).toHaveLength(MAX_RECENT_SEARCHES);
		expect(stored[0]).toBe(`term-${MAX_RECENT_SEARCHES + 1}`);
		expect(stored).not.toContain("term-0");
	});

	it("ignores blank submissions without touching storage", () => {
		rememberSearchTerm("fastapi");
		expect(rememberSearchTerm("   ")).toEqual(["fastapi"]);
		expect(readRecentSearches()).toEqual(["fastapi"]);
	});
});

describe("clearRecentSearches", () => {
	it("removes the stored list", () => {
		rememberSearchTerm("fastapi");
		clearRecentSearches();
		expect(readRecentSearches()).toEqual([]);
		expect(window.localStorage.getItem(RECENT_SEARCHES_KEY)).toBeNull();
	});
});

describe("useRecentSearches", () => {
	const Host = defineComponent({
		setup() {
			return useRecentSearches();
		},
		template: `<div><span v-for="term in recentSearches" :key="term">{{ term }}</span></div>`,
	});

	it("loads stored terms on mount", async () => {
		window.localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(["fastapi"]));
		const wrapper = mount(Host);
		await nextTick();
		expect(wrapper.text()).toContain("fastapi");
	});

	it("updates the rendered list on remember and clear", async () => {
		const wrapper = mount(Host);
		await nextTick();
		expect(wrapper.text()).toBe("");
		wrapper.vm.remember("nuxt");
		await nextTick();
		expect(wrapper.text()).toContain("nuxt");
		wrapper.vm.clear();
		await nextTick();
		expect(wrapper.text()).toBe("");
	});
});
