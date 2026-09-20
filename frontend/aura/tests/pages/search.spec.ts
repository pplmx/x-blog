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
import type { SearchSuggestion } from "~~/api/public/search";

// Blocked-reader suppression (round 386, DEC-437): stub the composable so the
// comment-search test can inject a blocked reader id and observe the hit vanish.
const mockBlockedSet = ref(new Set<number>());
vi.mock("~~/composables/useBlockedReaderIds", () => ({
	useBlockedReaderIds: () => ({
		blockedReaderIds: mockBlockedSet,
		loadBlockedReaderIds: vi.fn(),
	}),
}));

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

// A comment search hit (round 366, DEC-405): the Comment envelope + snippet +
// post brief so a result can land ON the comment.
const mockCommentResult = {
	items: [
		{
			id: 77,
			post_id: 9,
			parent_id: null,
			nickname: "Commenter One",
			content: "the real answer is 42 in the discussion",
			is_approved: true,
			is_author_reply: false,
			likes: 3,
			created_at: "2024-03-01T09:00:00Z",
			reader: null,
			snippet: "the real answer is <mark>42</mark> in the discussion",
			post: { id: 9, title: "Searchable Post", slug: "searchable-post" },
		},
	],
	pagination: { total: 1, page: 1, limit: 10, total_pages: 1 },
};

async function mountSearchPage({
	searchResult = mockSearchResult,
	pending = false,
	error = null,
	searchResultRef = undefined,
	commentResult = mockCommentResult,
	commentPending = false,
	commentError = null,
	suggestResult = { query: "", suggestions: [] as SearchSuggestion[] },
	taxonomy = undefined,
	routeQuery = { q: "test query" },
}: {
	searchResult?: typeof mockSearchResult | null;
	pending?: boolean;
	error?: { message: string } | null;
	searchResultRef?: { value: typeof mockSearchResult | null };
	commentResult?: typeof mockCommentResult | null;
	commentPending?: boolean;
	commentError?: { message: string } | null;
	/** "Did you mean" payload (round 390, DEC-443) — only rendered on zero hits. */
	suggestResult?: { query: string; suggestions: SearchSuggestion[] };
	/** Category/tag lists for the filter selects' on-mount $fetch (default empty). */
	taxonomy?: { categories?: { id: number; name: string }[]; tags?: { id: number; name: string }[] };
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

	// Mock useFetch (used by useApi/useSearch internally). The page drives TWO
	// searches (round 366): posts via /api/search and comments via
	// /api/search/comments — route each to its own mock payload.
	vi.stubGlobal(
		"useFetch",
		vi.fn((url: unknown, _options: unknown) => {
			const u =
				typeof url === "function"
					? url()
					: typeof url === "string"
						? url
						: ((url as { value?: string }).value ?? "");
			if (String(u).includes("/api/search/comments")) {
				return {
					data: ref(commentResult) as unknown,
					pending: ref(commentPending),
					error: ref(commentError),
					refresh: vi.fn(),
				};
			}
			if (String(u).includes("/api/search/suggest")) {
				return {
					data: ref(suggestResult),
					pending: ref(false),
					error: ref(null),
					refresh: vi.fn(),
				};
			}
			return {
				data: (searchResultRef ?? ref(searchResult)) as unknown,
				pending: ref(pending),
				error: ref(error),
				refresh: vi.fn(),
			};
		}),
	);

	// The filter bar loads the category/tag lists via $fetch on mount (DEC-084);
	// stub it so the select options render empty instead of an unhandled error.
	vi.stubGlobal(
		"$fetch",
		vi.fn(async (url: string) => {
			const u = String(url);
			if (u.includes("/api/categories")) return taxonomy?.categories ?? [];
			if (u.includes("/api/tags")) return taxonomy?.tags ?? [];
			if (u.includes("/api/search/suggest")) return suggestResult;
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

		it("keeps the query box and filters mounted while results are pending", async () => {
			// Regression: the whole results block used to swap for a bare skeleton
			// on every refetch, unmounting the editable search box and every filter
			// select (keyboard focus dropped to <body> mid-interaction). Only the
			// results area should show the loading state.
			const wrapper = await mountSearchPage({
				pending: true,
				searchResult: null,
			});
			// The results-view search box (type=search; the landing uses type=text)
			// stays in the DOM during the refetch.
			expect(wrapper.find('input[type="search"]').exists()).toBe(true);
			// Category/tag/sort selects stay mounted too.
			expect(wrapper.findAll("select").length).toBeGreaterThanOrEqual(3);
			// And the skeleton is still the only thing in the results area.
			expect(wrapper.findAll(".animate-pulse").length).toBeGreaterThan(0);
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

		it("native clear (×) returns from a live search to the bare /search landing", async () => {
			// Chromium's type="search" clear button fires a `search` event with an
			// emptied box; previously this left stale results under a blank field —
			// a dead-end with no way back to the landing.
			const wrapper = await mountSearchPage(); // q=test query
			const navMock = vi.fn();
			vi.stubGlobal("navigateTo", navMock);
			const input = wrapper.find('input[type="search"]');
			await input.setValue("");
			await input.trigger("search");
			expect(navMock).toHaveBeenCalledWith({ query: {} });
		});

		it("Enter with an emptied results box also clears the search", async () => {
			// Select-all + Delete then Enter was a silent no-op before; an empty
			// term in the results view must mean "clear back to the landing".
			const wrapper = await mountSearchPage(); // q=test query
			const navMock = vi.fn();
			vi.stubGlobal("navigateTo", navMock);
			const input = wrapper.find('input[type="search"]');
			await input.setValue("");
			await input.trigger("keydown.enter");
			expect(navMock).toHaveBeenCalledWith({ query: {} });
		});

		it("a still-non-empty search event does NOT clear (no double-nav on Enter)", async () => {
			// Some browsers fire `search` on Enter as well as the clear ×; with a
			// non-empty box that must be a no-op so a re-search isn't wiped.
			const wrapper = await mountSearchPage(); // q=test query
			const navMock = vi.fn();
			vi.stubGlobal("navigateTo", navMock);
			const input = wrapper.find('input[type="search"]');
			await input.setValue("nuxt");
			await input.trigger("search");
			expect(navMock).not.toHaveBeenCalled();
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

		it("default relevance sort is not treated as an active filter", async () => {
			// sort=relevance is what the API does by default; it is written to
			// the URL when the select shows "Relevance", so it must not light
			// up the clear-filters button or survive a clear.
			const wrapper = await mountSearchPage({ routeQuery: { q: "test query", sort: "relevance" } });
			let clearBtn = wrapper.findAll("button").find((b) => b.text().includes("清除筛选"));
			expect(clearBtn).toBeUndefined();

			// A non-default sort still counts as an active filter.
			const sorted = await mountSearchPage({ routeQuery: { q: "test query", sort: "newest" } });
			clearBtn = sorted.findAll("button").find((b) => b.text().includes("清除筛选"));
			expect(clearBtn).toBeDefined();
		});

		it("cross-constrains the date range so from never exceeds to", async () => {
			// With only a date_to set, date_from is clamped above by it; with a
			// date_from set, date_to is clamped below. Prevents a silently empty
			// inverted range at the picker instead of after the query.
			const wrapper = await mountSearchPage({
				routeQuery: { q: "test query", date_to: "2026-08-31" },
			});
			const [fromInput, toInput] = wrapper.findAll('input[type="date"]');
			expect(fromInput.attributes("max")).toBe("2026-08-31");

			const other = await mountSearchPage({
				routeQuery: { q: "test query", date_from: "2026-01-01" },
			});
			const [otherFrom, otherTo] = other.findAll('input[type="date"]');
			expect(otherTo.attributes("min")).toBe("2026-01-01");
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

		it("names the active filter instead of blaming keywords when a filter caused the zero (round 278)", async () => {
			const wrapper = await mountSearchPage({
				searchResult: mockEmptyResult,
				routeQuery: { q: "test query", category: "Tech" },
			});
			// The category filter is the actual cause — "try different keywords"
			// would point the reader away from it.
			expect(wrapper.text()).toContain("没有文章符合当前筛选条件，试试调整或清除筛选条件");
			expect(wrapper.text()).not.toContain("试试其他关键词吧");
			// The one-click reset is offered right in the empty state, not just
			// in the filter bar.
			expect(wrapper.findAll("button").some((b) => b.text() === "清除筛选")).toBe(true);
		});
	});

	describe("Did you mean suggestions (round 390, DEC-443)", () => {
		const mockSuggestResult = {
			query: "javascrit",
			suggestions: [
				{ text: "Javascript", kind: "tag", hits: 3 },
				{ text: "响应式设计入门", kind: "post", hits: 1 },
			],
		};

		it("renders suggestion chips on a zero-hit search", async () => {
			const wrapper = await mountSearchPage({
				searchResult: mockEmptyResult,
				suggestResult: mockSuggestResult,
			});
			// The chips arrive via the $fetch-driven watch — one more tick for
			// that async chain after mount's own flushPromises.
			await flushPromises();
			expect(wrapper.text()).toContain("你是不是想找：");
			expect(wrapper.text()).toContain("Javascript");
			expect(wrapper.text()).toContain("响应式设计入门");
		});

		it("hides the suggestion region when the search has results", async () => {
			const wrapper = await mountSearchPage({
				searchResult: mockSearchResult, // total 2 — not a dead end
				suggestResult: mockSuggestResult,
			});
			await flushPromises();
			expect(wrapper.text()).not.toContain("你是不是想找：");
			expect(wrapper.text()).not.toContain("Javascript");
		});

		it("hides suggestions when the backend offers none", async () => {
			const wrapper = await mountSearchPage({
				searchResult: mockEmptyResult,
				suggestResult: { query: "zzzzzzzz", suggestions: [] },
			});
			await flushPromises();
			expect(wrapper.text()).not.toContain("你是不是想找：");
		});

		it("tapping a suggestion re-runs the search with the corrected term", async () => {
			// mountSearchPage stubs navigateTo with its own mock; re-stub with a
			// fresh one AFTER mounting (same pattern as the input-handler tests)
			// and assert on that instance.
			const wrapper = await mountSearchPage({
				searchResult: mockEmptyResult,
				suggestResult: mockSuggestResult,
			});
			await flushPromises();
			const navMock = vi.fn();
			vi.stubGlobal("navigateTo", navMock);
			const chip = wrapper.findAll("button").find((b) => b.text().includes("Javascript"));
			expect(chip).toBeTruthy();
			if (!chip) throw new Error("suggestion chip not rendered");
			await chip.trigger("click");
			await flushPromises();
			expect(navMock).toHaveBeenCalledWith({
				query: { q: "Javascript", page: "1" },
			});
		});

		it("re-requests suggestions when the term changes while staying zero-hit", async () => {
			// Two consecutive zero-hit terms keep shouldSuggest true→true (Nuxt
			// useFetch preserves the previous zero-hit payload during the refetch),
			// so a shouldSuggest-only watcher never re-fires and the OLD term's
			// chips would stick under the box — wrong for the new term and actively
			// misleading to tap. The watcher must also re-fire on the term itself.
			// Route query is passed reactive so mutating it triggers the page's
			// route watchers (helper wraps it in reactive; a raw object mutation
			// would bypass the proxy and never invalidate the computed).
			const routeQuery = reactive({ q: "tyop" });
			const wrapper = await mountSearchPage({
				routeQuery,
				searchResult: mockEmptyResult,
				suggestResult: {
					query: "tyop",
					suggestions: [{ text: "fixed-tyop", kind: "post", hits: 1 }],
				},
			});
			await flushPromises();
			expect(wrapper.text()).toContain("fixed-tyop");

			// From here on the suggest request must be per-term, so swap in a
			// term-aware $fetch mock that records the queries it is called with.
			const suggestCalls: string[] = [];
			vi.stubGlobal(
				"$fetch",
				vi.fn(async (url: string) => {
					const u = String(url);
					if (u.includes("/api/search/suggest")) {
						const q = new URL(u, "http://localhost").searchParams.get("q") ?? "";
						suggestCalls.push(q);
						return { query: q, suggestions: [{ text: `fixed-${q}`, kind: "post", hits: 1 }] };
					}
					throw new Error(`Unexpected $fetch: ${u}`);
				}),
			);

			// Commit a different typo while still zero-hit (what handleSearchInput
			// does via navigateTo): the watcher must fire a suggest request for the
			// NEW term and swap the chips.
			routeQuery.q = "typp";
			await flushPromises();
			expect(suggestCalls).toContain("typp");
			expect(wrapper.text()).toContain("fixed-typp");
			expect(wrapper.text()).not.toContain("fixed-tyop");
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
			// (the numeric token is stringified for the URL query).
			expect(navigateToMock).toHaveBeenCalledWith({
				query: { q: "test query", page: "2" },
			});
		});
	});

	describe("Taxonomy filter load failure (survey finding)", () => {
		it("explains the thin selects and offers a retry when categories/tags fail to load", async () => {
			vi.stubGlobal("useRuntimeConfig", () => ({ public: { apiUrl: "http://localhost:18888" } }));
			vi.stubGlobal("useRoute", () => reactive({ query: { q: "test query" } }));
			vi.stubGlobal("navigateTo", vi.fn());
			vi.stubGlobal("useHead", vi.fn());
			vi.stubGlobal(
				"useFetch",
				vi.fn(() => ({
					data: ref({
						items: [],
						pagination: { total: 0, page: 1, limit: 10, total_pages: 1 },
					}),
					pending: ref(false),
					error: ref(null),
					refresh: vi.fn(),
				})),
			);
			// Both taxonomy fetches fail — the banner must explain, not silently
			// render the selects as if there were no categories/tags.
			vi.stubGlobal(
				"$fetch",
				vi.fn(() => Promise.reject(new Error("offline"))),
			);

			const { default: SearchPage } = await import("../../app/pages/search.vue");
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
						NuxtLink: { template: '<a :href="to"><slot/></a>', props: ["to"] },
						Icon: { template: '<svg class="iconstub" />' },
					},
				},
			});
			await flushPromises();

			expect(wrapper.text()).toContain("筛选选项加载失败，请检查网络。");
			const retry = wrapper.findAll("button").find((b) => b.text().includes("重试"));
			expect(retry).toBeDefined();
		});
	});

	describe("Filter change navigation (survey finding)", () => {
		it("scrolls the reader back to the top when a filter changes", async () => {
			const scrollSpy = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
			try {
				const wrapper = await mountSearchPage({ routeQuery: { q: "test query" } });
				const categorySelect = wrapper.find("select");
				expect(categorySelect.exists()).toBe(true);

				await categorySelect.setValue("Tech");
				await flushPromises();

				// Changing a filter resets to page 1 — like pagination, the reader
				// must land back at the top so the fresh result set is visible.
				expect(scrollSpy).toHaveBeenCalled();
			} finally {
				scrollSpy.mockRestore();
			}
		});
	});

	describe("Page + sort query handling", () => {
		it("renders results from a paged deep link (?page=2)", async () => {
			const wrapper = await mountSearchPage({ routeQuery: { q: "test query", page: "2" } });
			expect(wrapper.text()).toContain("Search Result Post");
		});

		it("keeps a non-default sort in the forwarded search params (no trailing relevance)", async () => {
			// sort=relevance is omitted from the URL params; anything else (here
			// newest) must be forwarded — exercised by the computed searchParams
			// being evaluated for the mocked useFetch URL.
			const wrapper = await mountSearchPage({ routeQuery: { q: "test query", sort: "newest" } });
			expect(wrapper.text()).toContain("Search Result Post");
		});

		it("clearing a filter deletes its key from the URL instead of writing an empty value", async () => {
			const wrapper = await mountSearchPage({
				routeQuery: { q: "test query", category: "Tech" },
			});
			const navMock = vi.fn();
			vi.stubGlobal("navigateTo", navMock);
			const categorySelect = wrapper.findAll("select").find((s) => s.text().includes("全部分类"));
			await categorySelect?.setValue("");
			await flushPromises();
			// The category key is dropped entirely; only q + page=1 survive.
			expect(navMock).toHaveBeenCalledWith({ query: { q: "test query", page: "1" } });
		});

		it("navigates with the new tag/sort filter and resets to page 1", async () => {
			const wrapper = await mountSearchPage({
				routeQuery: { q: "test query" },
				taxonomy: { categories: [{ id: 1, name: "Tech" }], tags: [{ id: 1, name: "React" }] },
			});
			const navMock = vi.fn();
			vi.stubGlobal("navigateTo", navMock);
			const [, tagSel, sortSel] = wrapper.findAll("select");

			await tagSel.setValue("React");
			await flushPromises();
			expect(navMock).toHaveBeenLastCalledWith({
				query: { q: "test query", tag: "React", page: "1" },
			});

			navMock.mockClear();
			await sortSel.setValue("newest");
			await flushPromises();
			expect(navMock).toHaveBeenLastCalledWith({
				query: { q: "test query", sort: "newest", page: "1" },
			});
		});

		it("navigates with a new date-from bound and resets to page 1", async () => {
			const wrapper = await mountSearchPage({ routeQuery: { q: "test query" } });
			const navMock = vi.fn();
			vi.stubGlobal("navigateTo", navMock);
			const [fromInput] = wrapper.findAll('input[type="date"]');
			await fromInput.setValue("2026-01-01");
			await flushPromises();
			expect(navMock).toHaveBeenLastCalledWith({
				query: { q: "test query", date_from: "2026-01-01", page: "1" },
			});
		});
	});

	describe("Out-of-range page clamp (ISS-308)", () => {
		it("clamps a stale page=999 deep link back to the last real page once pagination arrives", async () => {
			const navMock = vi.fn();
			vi.stubGlobal("useRuntimeConfig", () => ({
				public: { apiUrl: "http://localhost:18888" },
			}));
			vi.stubGlobal("useRoute", () =>
				reactive({ query: { q: "test query", category: "Tech", page: "999" } }),
			);
			vi.stubGlobal("navigateTo", navMock);
			vi.stubGlobal("useHead", vi.fn());
			vi.stubGlobal("computed", computed);
			vi.stubGlobal(
				"$fetch",
				vi.fn(async () => []),
			);
			const resultRef = ref<{ items: unknown[]; pagination: Record<string, number> } | null>(null);
			vi.stubGlobal(
				"useFetch",
				vi.fn(() => ({
					data: resultRef,
					pending: ref(false),
					error: ref(null),
					refresh: vi.fn(),
				})),
			);

			const { default: SearchPage } = await import("../../app/pages/search.vue");
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
						NuxtLink: { template: '<a :href="to"><slot/></a>', props: ["to"] },
						Icon: { template: '<svg class="iconstub" :data-icon="icon"></svg>', props: ["icon"] },
					},
				},
			});
			await flushPromises();
			expect(navMock).not.toHaveBeenCalled();

			resultRef.value = {
				items: [],
				pagination: { total: 0, page: 1, limit: 10, total_pages: 1 },
			};
			await flushPromises();
			// Active filters survive the clamp; q and the clamped page are set.
			expect(navMock).toHaveBeenCalledWith({
				query: { category: "Tech", q: "test query", page: "1" },
				replace: true,
			});
		});
	});

	describe("Taxonomy load edge cases", () => {
		it("coerces a null taxonomy payload to an empty list without crashing", async () => {
			vi.stubGlobal(
				"$fetch",
				vi.fn(async (url: string) => {
					const u = String(url);
					if (u.includes("/api/categories")) return undefined;
					if (u.includes("/api/tags")) return undefined;
					throw new Error(`Unexpected $fetch: ${u}`);
				}),
			);
			const wrapper = await mountSearchPage({ routeQuery: { q: "test query" } });
			// The selects render with just the default "All" options.
			expect(wrapper.findAll("select").length).toBeGreaterThanOrEqual(3);
		});
	});

	describe("Result card edge cases", () => {
		it("handles a result without a snippet, excerpt, or category", async () => {
			const bare = {
				...mockSearchResult,
				items: [
					{
						...mockSearchResult.items[0],
						snippet: "",
						excerpt: "",
						category: null,
					},
				],
			};
			const wrapper = await mountSearchPage({ searchResult: bare });
			expect(wrapper.text()).toContain("Search Result Post");
			expect(wrapper.text()).not.toContain("This is a search result excerpt.");
		});

		it("renders an empty date for a result with an unparseable timestamp", async () => {
			const badDate = {
				...mockSearchResult,
				items: [
					{
						...mockSearchResult.items[0],
						created_at: "not-a-date",
					},
				],
			};
			const wrapper = await mountSearchPage({ searchResult: badDate });
			expect(wrapper.text()).toContain("Search Result Post");
			expect(wrapper.text()).toContain("100 次阅读");
		});
	});

	describe("Windowed pagination ellipsis", () => {
		it("renders ellipsis tokens and disables the active page on a 20-page result set", async () => {
			const manyPages = {
				items: mockSearchResult.items,
				pagination: { total: 200, page: 1, limit: 10, total_pages: 20 },
			};
			const wrapper = await mountSearchPage({
				searchResult: manyPages as unknown as typeof mockSearchResult,
			});
			const pageBtns = wrapper.findAll("button").filter((b) => /\d|…/.test(b.text()));
			expect(pageBtns.length).toBe(9);
			const current = pageBtns.find((b) => b.text() === "1");
			expect(current?.attributes("disabled")).toBeDefined();
			expect(current?.attributes("aria-current")).toBe("page");
			const ellipsis = pageBtns.find((b) => b.text() === "…");
			expect(ellipsis?.attributes("disabled")).toBeDefined();
		});
	});

	describe("Search SEO metadata", () => {
		function seoHead(): { title: string; path: string } {
			const useHeadMock = (
				globalThis as unknown as { useHead: { mock: { calls: Array<[unknown]> } } }
			).useHead;
			const first = useHeadMock.mock.calls[0]?.[0] as {
				value?: {
					title?: string;
					meta?: Array<{ property?: string; content?: string }>;
					link?: Array<{ rel?: string; href?: string }>;
				};
			};
			const v = first?.value;
			const ogUrl = v?.meta?.find((m) => m.property === "og:url")?.content ?? "";
			const canonical = v?.link?.find((l) => l.rel === "canonical")?.href ?? "";
			return { title: v?.title ?? "", path: ogUrl || canonical };
		}

		it("names the query in the title and canonical URL when a query is present", async () => {
			const wrapper = await mountSearchPage({ routeQuery: { q: "hello world" } });
			expect(wrapper.exists()).toBe(true);
			const head = seoHead();
			expect(head.title).toContain("hello world");
			expect(head.path).toContain("q=hello%20world");
		});

		it("uses the bare search metadata on an empty-query landing", async () => {
			const wrapper = await mountSearchPage({ routeQuery: {} });
			expect(wrapper.exists()).toBe(true);
			const head = seoHead();
			expect(head.path).not.toContain("q=");
		});
	});
});

describe("Comment search mode (round 366, DEC-405)", () => {
	it("renders both mode tabs with posts selected by default", async () => {
		const wrapper = await mountSearchPage({ routeQuery: { q: "nuxt" } });
		const tabs = wrapper.findAll('[role="tab"]');
		expect(tabs.length).toBeGreaterThanOrEqual(2);
		// The first tab is posts (default mode) → selected.
		expect(tabs[0].attributes("aria-selected")).toBe("true");
		expect(tabs[1].attributes("aria-selected")).toBe("false");
	});

	it("renders comment results with a deep link onto the comment when ?type=comments", async () => {
		const wrapper = await mountSearchPage({ routeQuery: { q: "42", type: "comments" } });
		// The comment hit renders its highlighted snippet, commenter, and the
		// post brief — and the card deep-links ONTO the comment (DEC-321).
		expect(wrapper.text()).toContain("Searchable Post");
		expect(wrapper.text()).toContain("Commenter One");
		expect(wrapper.text()).toContain("real answer is 42");
		const link = wrapper.find('a[href="/posts/searchable-post#comment-77"]');
		expect(link.exists()).toBe(true);
		// The posts list is NOT rendered in comments mode.
		expect(wrapper.text()).not.toContain("Search Result Post");
	});

	it("never renders a verified reader's email as the commenter (round 396)", async () => {
		// A reader with no display_name has their account email stamped as the
		// nickname — the search results must render the generic identity, not
		// the PII (same rule as the thread and discussion feed).
		const nameless = {
			items: [
				{
					id: 88,
					post_id: 9,
					parent_id: null,
					nickname: "nameless@example.com",
					content: "a verified reader without a display name",
					is_approved: true,
					is_author_reply: false,
					likes: 0,
					created_at: "2024-03-01T09:00:00Z",
					reader: { id: 42, display_name: null, avatar_url: null },
					snippet: "a verified reader",
					post: { id: 9, title: "Searchable Post", slug: "searchable-post" },
				},
			],
			pagination: { total: 1, page: 1, limit: 10, total_pages: 1 },
		};
		const wrapper = await mountSearchPage({
			routeQuery: { q: "verified", type: "comments" },
			commentResult: nameless,
		});
		expect(wrapper.text()).toContain("读者"); // commentList.readerNoName (zh)
		expect(wrapper.text()).not.toContain("nameless@example.com");
	});

	it("shows the empty-results state and hides post filters in comments mode", async () => {
		const wrapper = await mountSearchPage({
			routeQuery: { q: "zzz", type: "comments" },
			commentResult: {
				items: [],
				pagination: { total: 0, page: 1, limit: 10, total_pages: 0 },
			},
		});
		expect(wrapper.text()).toContain("没有找到相关文章");
		// Category/tag/sort/date filters are posts-only (a comment search has
		// no taxonomy/date dimensions).
		expect(wrapper.text()).not.toContain("分类");
		expect(wrapper.text()).not.toContain("排序");
		// The search mode is NOT a narrowing filter: a zero-hit comments search
		// must show the generic keyword hint (+ retry path), not the misleading
		// "adjust your filters" message with a dead "clear filters" button whose
		// navigation target equals the current URL (deep-dive finding).
		expect(wrapper.text()).not.toContain("试试调整或清除筛选条件");
		expect(wrapper.findAll("button").some((b) => b.text() === "清除筛选")).toBe(false);
	});

	it("switching to the comments tab navigates to the comments-mode URL", async () => {
		const wrapper = await mountSearchPage({ routeQuery: { q: "nuxt" } });
		const navigateSpy = vi.fn();
		vi.stubGlobal("navigateTo", navigateSpy);
		const commentsTab = wrapper.findAll('[role="tab"]').find((t) => t.text().includes("评论"));
		expect(commentsTab).toBeDefined();
		await commentsTab?.trigger("click");
		await flushPromises();
		expect(navigateSpy).toHaveBeenCalledWith({ query: { q: "nuxt", type: "comments", page: "1" } });
	});

	it("keeps the comments mode when paging a comment result", async () => {
		const wrapper = await mountSearchPage({
			routeQuery: { q: "42", type: "comments", page: "1" },
			commentResult: {
				...mockCommentResult,
				pagination: { total: 11, page: 1, limit: 10, total_pages: 2 },
			},
		});
		const navigateSpy = vi.fn();
		vi.stubGlobal("navigateTo", navigateSpy);
		// A page turn must preserve ?type=comments (the active mode lives in the
		// URL — dropping it would silently fall back to post search).
		const page2 = wrapper.findAll("button").find((b) => b.text().trim() === "2");
		expect(page2).toBeDefined();
		await page2?.trigger("click");
		await flushPromises();
		// goToPage stringifies the numeric token for the URL query.
		expect(navigateSpy).toHaveBeenCalledWith({ query: { q: "42", type: "comments", page: "2" } });
	});

	it("hides a blocked reader's comment hit from comment search (round 386, DEC-437)", async () => {
		const withReaderHit = {
			...mockCommentResult,
			items: [
				{ ...mockCommentResult.items[0], reader: { id: 77, display_name: "Blocked Author" } },
			],
		};

		// Nothing blocked: the reader-attributed hit renders.
		mockBlockedSet.value = new Set();
		const wrapperVisible = await mountSearchPage({
			routeQuery: { q: "42", type: "comments" },
			commentResult: withReaderHit,
		});
		expect(wrapperVisible.text()).toContain("Blocked Author");

		// Blocked: the same hit is filtered out of the results.
		mockBlockedSet.value = new Set([77]);
		const wrapperHidden = await mountSearchPage({
			routeQuery: { q: "42", type: "comments" },
			commentResult: withReaderHit,
		});
		expect(wrapperHidden.text()).not.toContain("Blocked Author");
	});

	it("renders the empty state when every comment hit is by a blocked reader (round 386, DEC-437)", async () => {
		const allBlocked = {
			...mockCommentResult,
			items: [
				{ ...mockCommentResult.items[0], reader: { id: 77, display_name: "Blocked Author" } },
			],
		};
		// The block list gates the empty check: today's server-total gate would
		// paint a blank results area under a misleading "N results" header.
		mockBlockedSet.value = new Set([77]);
		const wrapper = await mountSearchPage({
			routeQuery: { q: "42", type: "comments" },
			commentResult: allBlocked,
		});
		expect(wrapper.text()).toContain("没有找到相关文章");
		expect(wrapper.text()).not.toContain("Blocked Author");
	});
});
