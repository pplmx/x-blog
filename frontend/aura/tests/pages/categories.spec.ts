/**
 * Categories page tests
 * Tests rendering states: loading, all categories view, category posts view,
 * post metadata, pagination, and back link.
 *
 * Mocks Nuxt composables (useFetch, useRuntimeConfig, useRoute, navigateTo)
 * and stubs NuxtLink and Icon components.
 *
 * The categories page uses `await useCategories(...)` and `await useApi(...)`
 * in <script setup>, making the setup async. We wrap in a <Suspense> boundary.
 */

import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { computed, reactive, ref } from "vue";

// Mock data
const mockCategories = [
	{ id: 1, name: "Tech" },
	{ id: 2, name: "Design" },
	{ id: 3, name: "Life" },
];

const mockCategoryPosts = {
	items: [
		{
			id: 1,
			title: "Categorized Post One",
			slug: "categorized-post-one",
			excerpt: "First categorized post excerpt.",
			published: true,
			created_at: "2024-01-20T10:00:00Z",
			views: 100,
			cover_image: null,
			category: { id: 1, name: "Tech" },
			tags: [],
		},
	],
	pagination: {
		total: 1,
		page: 1,
		limit: 10,
		total_pages: 1,
	},
};

const mockEmptyPosts = {
	items: [],
	pagination: {
		total: 0,
		page: 1,
		limit: 10,
		total_pages: 1,
	},
};

async function mountCategoriesPage({
	categories = mockCategories,
	posts = mockCategoryPosts,
	pending = false,
	routeQuery = {},
}: {
	categories?: typeof mockCategories | null;
	posts?: typeof mockCategoryPosts | null;
	pending?: boolean;
	routeQuery?: Record<string, string>;
} = {}) {
	vi.stubGlobal("useRuntimeConfig", () => ({
		public: {
			apiUrl: "http://localhost:18888",
		},
	}));

	vi.stubGlobal("useRoute", () => reactive({ query: routeQuery }));

	vi.stubGlobal("navigateTo", vi.fn());

	vi.stubGlobal("useHead", vi.fn());

	// The categories page uses computed without importing it (Nuxt auto-imports it)
	vi.stubGlobal("computed", computed);

	// Mock useFetch (used by useApi/useCategories internally)
	vi.stubGlobal(
		"useFetch",
		vi.fn((url: string | (() => string) | { value: string }) => {
			const urlStr =
				typeof url === "function" ? url() : typeof url === "string" ? url : (url.value ?? "");
			if (urlStr.includes("/api/categories") && !urlStr.includes("/posts")) {
				return {
					data: ref(categories),
					pending: ref(false),
					error: ref(null),
					refresh: vi.fn(),
				};
			}
			if (urlStr.includes("/api/posts")) {
				return {
					data: ref(posts),
					pending: ref(pending),
					error: ref(null),
					refresh: vi.fn(),
				};
			}
			return {
				data: ref(null),
				pending: ref(false),
				error: ref(null),
				refresh: vi.fn(),
			};
		}),
	);

	const { default: CategoriesPage } = await import("../../app/pages/categories.vue");

	const SuspenseWrapper: any = {
		components: { CategoriesPage },
		template:
			"<Suspense>" +
			"<template #default><CategoriesPage /></template>" +
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

describe("Categories Page", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("All categories view (no category_id)", () => {
		it("renders the all categories header", async () => {
			const wrapper = await mountCategoriesPage();
			expect(wrapper.text()).toContain("全部分类");
		});

		it("renders the category count", async () => {
			const wrapper = await mountCategoriesPage();
			expect(wrapper.text()).toContain("共 3 个分类");
		});

		it("renders all categories as links", async () => {
			const wrapper = await mountCategoriesPage();
			expect(wrapper.text()).toContain("Tech");
			expect(wrapper.text()).toContain("Design");
			expect(wrapper.text()).toContain("Life");
		});
	});

	describe("Loading state", () => {
		it("renders loading skeletons when data is pending", async () => {
			const wrapper = await mountCategoriesPage({ pending: true });
			const skeletons = wrapper.findAll(".animate-pulse");
			expect(skeletons.length).toBeGreaterThan(0);
		});
	});

	describe("Empty categories state", () => {
		it("renders empty state when no categories", async () => {
			const wrapper = await mountCategoriesPage({ categories: [] });
			expect(wrapper.text()).toContain("暂无分类");
		});
	});

	describe("Category posts view (category_id selected)", () => {
		it("renders back to all categories link", async () => {
			const wrapper = await mountCategoriesPage({ routeQuery: { category_id: "1" } });
			const backLink = wrapper.find('a[href="/categories"]');
			expect(backLink.exists()).toBe(true);
			expect(backLink.text()).toContain("返回");
		});

		it("renders the category posts header", async () => {
			const wrapper = await mountCategoriesPage({ routeQuery: { category_id: "1" } });
			expect(wrapper.text()).toContain("分类文章");
		});

		it("renders post titles", async () => {
			const wrapper = await mountCategoriesPage({ routeQuery: { category_id: "1" } });
			expect(wrapper.text()).toContain("Categorized Post One");
		});

		it("renders post excerpts", async () => {
			const wrapper = await mountCategoriesPage({ routeQuery: { category_id: "1" } });
			expect(wrapper.text()).toContain("First categorized post excerpt.");
		});

		it("renders post category names", async () => {
			const wrapper = await mountCategoriesPage({ routeQuery: { category_id: "1" } });
			expect(wrapper.text()).toContain("Tech");
		});

		it("renders post view counts", async () => {
			const wrapper = await mountCategoriesPage({ routeQuery: { category_id: "1" } });
			expect(wrapper.text()).toContain("100 次阅读");
		});

		it("renders post links with correct hrefs", async () => {
			const wrapper = await mountCategoriesPage({ routeQuery: { category_id: "1" } });
			const links = wrapper.findAll('a[href^="/posts/"]');
			expect(links.length).toBeGreaterThanOrEqual(1);
		});
	});

	describe("Scoped RSS feed (DEC-074, TASK-146)", () => {
		function alternateLinksFromHead(): Array<{ rel: string; href?: string; type?: string }> {
			const useHeadMock = (
				globalThis as unknown as { useHead: { mock: { calls: Array<[unknown]> } } }
			).useHead;
			return useHeadMock.mock.calls
				.map(([arg]) => arg)
				.filter((arg): arg is () => { link?: unknown[] } => typeof arg === "function")
				.map((getter) => getter())
				.flatMap((h) => (h?.link ?? []) as Array<{ rel: string; href?: string; type?: string }>);
		}

		it("renders a subscribe link pointing at the category-scoped feed", async () => {
			const wrapper = await mountCategoriesPage({ routeQuery: { category_id: "1" } });
			const link = wrapper.find('a[href="/rss/category/Tech.xml"]');
			expect(link.exists()).toBe(true);
			expect(link.text()).toContain("RSS 订阅");
		});

		it("emits an alternate autodiscovery link for the selected category", async () => {
			await mountCategoriesPage({ routeQuery: { category_id: "1" } });
			const links = alternateLinksFromHead();
			expect(
				links.some(
					(l) =>
						l.rel === "alternate" &&
						l.href === "/rss/category/Tech.xml" &&
						l.type === "application/rss+xml",
				),
			).toBe(true);
		});

		it("emits no autodiscovery link on the all-categories view", async () => {
			await mountCategoriesPage();
			const links = alternateLinksFromHead();
			expect(links.some((l) => l.rel === "alternate")).toBe(false);
		});
	});

	describe("Empty category posts", () => {
		it("renders empty state when category has no posts", async () => {
			const wrapper = await mountCategoriesPage({
				routeQuery: { category_id: "1" },
				posts: mockEmptyPosts,
			});
			expect(wrapper.text()).toContain("暂无文章");
		});
	});

	describe("Pagination navigation", () => {
		it("calls navigateTo with correct query when clicking a pagination button", async () => {
			const navigateToMock = vi.fn();

			const mockMultiPagePosts = {
				items: [
					{
						id: 1,
						title: "Categorized Post One",
						slug: "categorized-post-one",
						excerpt: "First categorized post excerpt.",
						published: true,
						created_at: "2024-01-20T10:00:00Z",
						views: 100,
						cover_image: null,
						category: { id: 1, name: "Tech" },
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

			vi.stubGlobal("useRuntimeConfig", () => ({
				public: {
					apiUrl: "http://localhost:18888",
				},
			}));

			vi.stubGlobal("useRoute", () => reactive({ query: { category_id: "1" } }));

			vi.stubGlobal("useHead", vi.fn());

			vi.stubGlobal(
				"useFetch",
				vi.fn((url: string | (() => string) | { value: string }) => {
					const urlStr =
						typeof url === "function" ? url() : typeof url === "string" ? url : (url.value ?? "");
					if (urlStr.includes("/api/categories") && !urlStr.includes("/posts")) {
						return {
							data: ref(mockCategories),
							pending: ref(false),
							error: ref(null),
							refresh: vi.fn(),
						};
					}
					if (urlStr.includes("/api/posts")) {
						return {
							data: ref(mockMultiPagePosts),
							pending: ref(false),
							error: ref(null),
							refresh: vi.fn(),
						};
					}
					return {
						data: ref(null),
						pending: ref(false),
						error: ref(null),
						refresh: vi.fn(),
					};
				}),
			);

			const { default: CategoriesPage } = await import("@/pages/categories.vue");

			const SuspenseWrapper: any = {
				components: { CategoriesPage },
				template:
					"<Suspense>" +
					"<template #default><CategoriesPage /></template>" +
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

			// Verify navigateTo was called with category_id and page 2
			expect(navigateToMock).toHaveBeenCalledWith({
				query: { category_id: "1", page: 2 },
			});
		});
	});
});
