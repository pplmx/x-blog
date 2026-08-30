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
	routeQuery = { q: "test query" },
}: {
	searchResult?: typeof mockSearchResult | null;
	pending?: boolean;
	error?: { message: string } | null;
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

	// The filter bar loads the category/tag lists via $fetch on mount (DEC-084);
	// stub it so the select options render empty instead of an unhandled error.
	vi.stubGlobal(
		"$fetch",
		vi.fn(async (url: string) => {
			const u = String(url);
			if (u.includes("/api/categories")) return [];
			if (u.includes("/api/tags")) return [];
			throw new Error(`Unexpected $fetch in search test: ${u}`);
		}),
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
			const wrapper = await mountSearchPage({ routeQuery: {} });
			expect(wrapper.text()).toContain("搜索文章");
			expect(wrapper.text()).toContain("输入关键词开始搜索");
		});

		it("renders a search icon", async () => {
			const wrapper = await mountSearchPage({ routeQuery: {} });
			const svg = wrapper.find("svg");
			expect(svg.exists()).toBe(true);
		});

		it("renders a search input field", async () => {
			const wrapper = await mountSearchPage({ routeQuery: {} });
			const input = wrapper.find('input[type="text"]');
			expect(input.exists()).toBe(true);
			expect(input.attributes("placeholder")).toContain("关键词");
		});

		it("renders a search button inside the input area", async () => {
			const wrapper = await mountSearchPage({ routeQuery: {} });
			const icon = wrapper.find(".iconstub");
			expect(icon.exists()).toBe(true);
		});

		it("skips the search request when there is no query", async () => {
			// The backend requires q (min_length=1): an empty-query visit used
			// to fire a guaranteed-422 request, burning a rate-limit slot.
			await mountSearchPage({ routeQuery: {} });
			const mockFetch = vi.mocked(useFetch);
			const [, options] = mockFetch.mock.calls[0] as [
				unknown,
				{ enabled?: import("vue").Ref<boolean> },
			];
			expect(options.enabled?.value).toBe(false);
		});

		it("enables the search request when a query is present", async () => {
			await mountSearchPage({ routeQuery: { q: "nuxt" } });
			const mockFetch = vi.mocked(useFetch);
			const [, options] = mockFetch.mock.calls[0] as [
				unknown,
				{ enabled?: import("vue").Ref<boolean> },
			];
			expect(options.enabled?.value).toBe(true);
		});
	});

	describe("Search input handler", () => {
		// NB: mountSearchPage re-stubs navigateTo with its own mock internally,
		// so we re-stub it AFTER mounting and read from that instance.
		let navMock: ReturnType<typeof vi.fn>;

		// The search input is only rendered in the empty-query state (with a
		// query the results view replaces it), so all input-handler tests mount
		// with no route query.

		it("does nothing on Enter with an empty input", async () => {
			const wrapper = await mountSearchPage({ routeQuery: {} });
			navMock = vi.fn();
			vi.stubGlobal("navigateTo", navMock);
			const input = wrapper.find('input[type="text"]');
			await input.trigger("keydown.enter");
			expect(navMock).not.toHaveBeenCalled();
		});

		it("navigates to the typed term on Enter", async () => {
			const wrapper = await mountSearchPage({ routeQuery: {} });
			navMock = vi.fn();
			vi.stubGlobal("navigateTo", navMock);
			const input = wrapper.find('input[type="text"]');
			await input.setValue("nuxt");
			await input.trigger("keydown.enter");
			// New (non-empty) term → move to the fresh result set at page 1,
			// preserving any active filters (they are empty here).
			expect(navMock).toHaveBeenCalledWith({ query: { page: "1", q: "nuxt" } });
		});

		it("keeps the input in sync with a route query on mount", async () => {
			const wrapper = await mountSearchPage({ routeQuery: {} });
			const input = wrapper.find('input[type="text"]');
			// The empty-query page has no route query, so the input starts blank
			// (the watch would populate it only if ?q= existed at mount).
			expect((input.element as HTMLInputElement).value).toBe("");
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
		it("renders a friendly error message when fetch fails", async () => {
			const wrapper = await mountSearchPage({
				error: { message: "Network error" },
				searchResult: null,
			});
			expect(wrapper.text()).toContain("加载失败");
			// ISS-135: never leak the raw backend/exception message to readers.
			expect(wrapper.text()).not.toContain("Network error");
		});
	});

	describe("Search results header", () => {
		it("renders the search results title", async () => {
			const wrapper = await mountSearchPage();
			expect(wrapper.text()).toContain("搜索结果");
		});

		it("renders an editable query input in the results view (deep-link refinement)", async () => {
			// A reader landing on /search?q=... from a shared link or the header
			// search must be able to refine the term in place — the results view
			// previously rendered no search box at all (dead-end).
			const wrapper = await mountSearchPage(); // routeQuery defaults to { q: "test query" }
			const input = wrapper.find('input[type="search"]');
			expect(input.exists()).toBe(true);
			expect((input.element as HTMLInputElement).value).toBe("test query");
		});

		it("re-queries from the results-view input on Enter", async () => {
			const wrapper = await mountSearchPage(); // q=test query
			const navMock = vi.fn();
			vi.stubGlobal("navigateTo", navMock);
			const input = wrapper.find('input[type="search"]');
			await input.setValue("nuxt");
			await input.trigger("keydown.enter");
			// New term → fresh result set at page 1, preserving active filters.
			expect(navMock).toHaveBeenCalledWith({ query: { page: "1", q: "nuxt" } });
		});

		it("renders a one-click clear-filters button only when a filter is active", async () => {
			// No narrowing filter active (only q): no clear button.
			const plain = await mountSearchPage();
			let clearBtn = plain.findAll("button").find((b) => b.text().includes("清除筛选"));
			expect(clearBtn).toBeUndefined();

			// A category filter in the URL makes it appear.
			const filtered = await mountSearchPage({ routeQuery: { q: "test query", category: "Tech" } });
			clearBtn = filtered.findAll("button").find((b) => b.text().includes("清除筛选"));
			expect(clearBtn).toBeDefined();
		});

		it("clear-filters drops every narrowing filter but keeps the query", async () => {
			const wrapper = await mountSearchPage({
				routeQuery: { q: "test query", category: "Tech", sort: "newest" },
			});
			const navMock = vi.fn();
			vi.stubGlobal("navigateTo", navMock);
			const clearBtn = wrapper.findAll("button").find((b) => b.text().includes("清除筛选"));
			expect(clearBtn).toBeDefined();
			if (!clearBtn) throw new Error("expected a clear-filters button");
			await clearBtn.trigger("click");
			expect(navMock).toHaveBeenCalledWith({ query: { q: "test query", page: "1" } });
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

		it("renders a highlighted snippet when the backend provides one (DEC-071)", async () => {
			// The backend emits a <mark>-highlighted snippet (CJK-aware since
			// DEC-071); the page renders it sanitized and the term is visible.
			const withSnippet = {
				...mockSearchResult,
				items: [
					{
						...mockSearchResult.items[0],
						snippet: "开头 <mark>评论系统</mark> 出现在摘要里",
					},
				],
			};
			const wrapper = await mountSearchPage({ searchResult: withSnippet });
			expect(wrapper.find("mark").exists()).toBe(true);
			expect(wrapper.text()).toContain("评论系统");
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
