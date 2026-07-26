/**
 * Search page tests
 * Tests rendering states: empty query, loading, error, empty results,
 * results listing, metadata display, and pagination.
 *
 * Mocks Nuxt composables (useFetch, useRuntimeConfig, useRoute, navigateTo)
 * and stubs NuxtLink and Icon components (same pattern as other page tests).
 *
 * The search page uses `await useSearch(...)` in <script setup>, making the
 * setup function async. We wrap the component in a <Suspense> boundary.
 */

import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { computed, reactive, ref } from "vue";

// Mock data matching PostListResponse
const mockSearchResult = {
	items: [
		{
			id: 1,
			title: "Search Result Post",
			slug: "search-result-post",
			excerpt: "This is a search result excerpt.",
			published: true,
			created_at: "2024-01-20T10:00:00Z",
			views: 100,
			cover_image: null,
			category: { id: 1, name: "Tech" },
			tags: [],
		},
		{
			id: 2,
			title: "Another Result",
			slug: "another-result",
			excerpt: "Another search result.",
			published: true,
			created_at: "2024-02-25T14:30:00Z",
			views: 50,
			cover_image: null,
			category: { id: 2, name: "Life" },
			tags: [],
		},
	],
	pagination: {
		total: 2,
		page: 1,
		limit: 10,
		total_pages: 2,
	},
};

const mockEmptyResult = {
	items: [],
	pagination: {
		total: 0,
		page: 1,
		limit: 10,
		total_pages: 1,
	},
};

async function mountSearchPage({
	searchResult = mockSearchResult,
	pending = false,
	error = null,
	query = "test query",
	routeQuery = { q: "test query" },
}: {
	searchResult?: typeof mockSearchResult | null;
	pending?: boolean;
	error?: { message: string } | null;
	query?: string;
	routeQuery?: Record<string, string>;
} = {}) {
	const navigateToMock = vi.fn();

	vi.stubGlobal("useRuntimeConfig", () => ({
		public: {
			apiUrl: "http://localhost:18888",
		},
	}));

	vi.stubGlobal("useRoute", () => reactive({ query: routeQuery }));

	vi.stubGlobal("navigateTo", navigateToMock);

	vi.stubGlobal("useHead", vi.fn());

	// The search page uses `computed` without importing it (Nuxt auto-imports it)
	vi.stubGlobal("computed", computed);

	// Mock useFetch (used by useApi/useSearch internally)
	vi.stubGlobal(
		"useFetch",
		vi.fn(() => ({
			data: ref(searchResult),
			pending: ref(pending),
			error: ref(error),
			refresh: vi.fn(),
		})),
	);

	const { default: SearchPage } = await import("../../app/pages/search.vue");

	// Template-based Suspense wrapper
	const SuspenseWrapper: any = {
		components: { SearchPage },
		template:
			"<Suspense>" +
			"<template #default><SearchPage /></template>" +
			"<template #fallback>Loading...</template>" +
			"</Suspense>",
	};

	const wrapper = mount(SuspenseWrapper, {
		global: {
			stubs: {
				NuxtLink: {
					template: '<a :href="to"><slot/></a>',
					props: ["to"],
				},
				Icon: {
					template: '<svg class="iconstub" :data-icon="icon"></svg>',
					props: ["icon"],
				},
			},
		},
	});

	await flushPromises();
	return wrapper;
}

describe("Search Page", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("Empty query state", () => {
		it("renders the search prompt when no query", async () => {
			const wrapper = await mountSearchPage({ query: "", routeQuery: {} });
			expect(wrapper.text()).toContain("搜索文章");
			expect(wrapper.text()).toContain("输入关键词开始搜索");
		});

		it("renders a search icon", async () => {
			const wrapper = await mountSearchPage({ query: "", routeQuery: {} });
			const svg = wrapper.find("svg");
			expect(svg.exists()).toBe(true);
		});

		it("renders a search input field", async () => {
			const wrapper = await mountSearchPage({ query: "", routeQuery: {} });
			const input = wrapper.find('input[type="text"]');
			expect(input.exists()).toBe(true);
			expect(input.attributes("placeholder")).toContain("关键词");
		});

		it("renders a search button inside the input area", async () => {
			const wrapper = await mountSearchPage({ query: "", routeQuery: {} });
			const icon = wrapper.find(".iconstub");
			expect(icon.exists()).toBe(true);
		});
	});

	describe("Loading state", () => {
		it("renders loading skeletons when results are pending", async () => {
			const wrapper = await mountSearchPage({
				pending: true,
				searchResult: null,
			});
			const skeletons = wrapper.findAll(".animate-pulse");
			expect(skeletons.length).toBeGreaterThan(0);
		});
	});

	describe("Error state", () => {
		it("renders error message when fetch fails", async () => {
			const wrapper = await mountSearchPage({
				error: { message: "Network error" },
				searchResult: null,
			});
			expect(wrapper.text()).toContain("加载失败: Network error");
		});
	});

	describe("Search results header", () => {
		it("renders the search results title", async () => {
			const wrapper = await mountSearchPage();
			expect(wrapper.text()).toContain("搜索结果");
		});

		it("renders the found count", async () => {
			const wrapper = await mountSearchPage();
			expect(wrapper.text()).toContain("找到");
			expect(wrapper.text()).toContain("2 篇");
		});

		it("renders the search query in the text", async () => {
			const wrapper = await mountSearchPage({
				query: "hello world",
				routeQuery: { q: "hello world" },
			});
			expect(wrapper.text()).toContain("hello world");
		});
	});

	describe("Empty results", () => {
		it("renders empty state when no results", async () => {
			const wrapper = await mountSearchPage({ searchResult: mockEmptyResult });
			expect(wrapper.text()).toContain("没有找到相关文章");
		});

		it("renders suggestion text in empty state", async () => {
			const wrapper = await mountSearchPage({ searchResult: mockEmptyResult });
			expect(wrapper.text()).toContain("试试其他关键词吧");
		});
	});

	describe("Results listing", () => {
		it("renders post titles", async () => {
			const wrapper = await mountSearchPage();
			expect(wrapper.text()).toContain("Search Result Post");
			expect(wrapper.text()).toContain("Another Result");
		});

		it("renders post excerpts", async () => {
			const wrapper = await mountSearchPage();
			expect(wrapper.text()).toContain("This is a search result excerpt.");
		});

		it("renders post category names", async () => {
			const wrapper = await mountSearchPage();
			expect(wrapper.text()).toContain("Tech");
			expect(wrapper.text()).toContain("Life");
		});

		it("renders post view counts", async () => {
			const wrapper = await mountSearchPage();
			expect(wrapper.text()).toContain("100 次阅读");
			expect(wrapper.text()).toContain("50 次阅读");
		});

		it("renders post links with correct hrefs", async () => {
			const wrapper = await mountSearchPage();
			const links = wrapper.findAll('a[href^="/posts/"]');
			expect(links.length).toBeGreaterThanOrEqual(2);
		});
	});

	describe("Pagination", () => {
		it("renders pagination when there are multiple pages", async () => {
			const wrapper = await mountSearchPage();
			const buttons = wrapper.findAll("button");
			const pageButtons = buttons.filter((b) => /\d/.test(b.text()));
			expect(pageButtons.length).toBeGreaterThan(0);
		});

		it("calls navigateTo with correct query when clicking a pagination button", async () => {
			const navigateToMock = vi.fn();

			vi.stubGlobal("useRuntimeConfig", () => ({
				public: {
					apiUrl: "http://localhost:18888",
				},
			}));

			vi.stubGlobal("useRoute", () => reactive({ query: { q: "test query" } }));

			vi.stubGlobal("navigateTo", navigateToMock);

			vi.stubGlobal(
				"useFetch",
				vi.fn(() => ({
					data: ref(mockSearchResult),
					pending: ref(false),
					error: ref(null),
					refresh: vi.fn(),
				})),
			);

			const { default: SearchPage } = await import("@/pages/search.vue");

			const SuspenseWrapper: any = {
				components: { SearchPage },
				template:
					"<Suspense>" +
					"<template #default><SearchPage /></template>" +
					"<template #fallback>Loading...</template>" +
					"</Suspense>",
			};

			const wrapper = mount(SuspenseWrapper, {
				global: {
					stubs: {
						NuxtLink: {
							template: '<a :href="to"><slot/></a>',
							props: ["to"],
						},
						Icon: {
							template: '<svg class="iconstub" :data-icon="icon"></svg>',
							props: ["icon"],
						},
					},
					mocks: {
						navigateTo: navigateToMock,
					},
				},
			});

			await flushPromises();

			// Find the page 2 button and click it
			const pageButtons = wrapper.findAll("button").filter((b) => /\d/.test(b.text()));
			expect(pageButtons.length).toBeGreaterThan(1);

			await pageButtons[1].trigger("click");

			// Verify navigateTo was called with the search query and page 2
			expect(navigateToMock).toHaveBeenCalledWith({
				query: { q: "test query", page: 2 },
			});
		});
	});
});
