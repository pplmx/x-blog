/**
 * Tags page tests
 * Tests rendering states: loading, all tags view, tag posts view,
 * post metadata, pagination, and back link.
 *
 * Mocks Nuxt composables (useFetch, useRuntimeConfig, useRoute, navigateTo)
 * and stubs NuxtLink and Icon components.
 *
 * The tags page uses `await useTags(...)` and `await usePosts(...)` in
 * <script setup>, making the setup async. We wrap in a <Suspense> boundary.
 */

import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { computed, reactive, ref } from "vue";

// Mock data
const mockTags = [
	{ id: 1, name: "React" },
	{ id: 2, name: "TypeScript" },
	{ id: 3, name: "Vue" },
];

const mockTagPosts = {
	items: [
		{
			id: 1,
			title: "Tagged Post One",
			slug: "tagged-post-one",
			excerpt: "First tagged post excerpt.",
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

async function mountTagsPage({
	tags = mockTags,
	posts = mockTagPosts,
	pending = false,
	routeQuery = {},
}: {
	tags?: typeof mockTags | null;
	posts?: typeof mockTagPosts | null;
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

	// The tags page uses computed without importing it (Nuxt auto-imports it)
	vi.stubGlobal("computed", computed);

	// Mock useFetch (used by useApi/useTags/usePosts internally)
	// Return different data based on URL path. The URL may be a string or a
	// reactive getter (the tags page passes a computed URL so it refetches
	// when route query params change).
	vi.stubGlobal(
		"useFetch",
		vi.fn((url: string | (() => string) | { value: string }) => {
			const urlStr = typeof url === "function" ? url() : typeof url === "string" ? url : (url.value ?? "");
			if (urlStr.includes("/api/tags") && !urlStr.includes("/posts")) {
				return {
					data: ref(tags),
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

	const { default: TagsPage } = await import("../../app/pages/tags.vue");

	// Template-based Suspense wrapper
	const SuspenseWrapper: any = {
		components: { TagsPage },
		template:
			"<Suspense>" +
			"<template #default><TagsPage /></template>" +
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

describe("Tags Page", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("All tags view (no tag_id)", () => {
		it("renders the all tags header", async () => {
			const wrapper = await mountTagsPage();
			expect(wrapper.text()).toContain("所有标签");
		});

		it("renders the tag count", async () => {
			const wrapper = await mountTagsPage();
			expect(wrapper.text()).toContain("共 3 个标签");
		});

		it("renders all tags as links", async () => {
			const wrapper = await mountTagsPage();
			expect(wrapper.text()).toContain("React");
			expect(wrapper.text()).toContain("TypeScript");
			expect(wrapper.text()).toContain("Vue");
		});

		it("renders tags with hash prefix", async () => {
			const wrapper = await mountTagsPage();
			expect(wrapper.text()).toContain("#React");
			expect(wrapper.text()).toContain("#TypeScript");
		});
	});

	describe("Loading state", () => {
		it("renders loading skeletons when data is pending", async () => {
			const wrapper = await mountTagsPage({ pending: true });
			const skeletons = wrapper.findAll(".animate-pulse");
			expect(skeletons.length).toBeGreaterThan(0);
		});
	});

	describe("Empty tags state", () => {
		it("renders empty state when no tags", async () => {
			const wrapper = await mountTagsPage({ tags: [] });
			expect(wrapper.text()).toContain("暂无标签");
		});
	});

	describe("Tag posts view (tag_id selected)", () => {
		it("renders back to all tags link", async () => {
			const wrapper = await mountTagsPage({ routeQuery: { tag_id: "1" } });
			const backLink = wrapper.find('a[href="/tags"]');
			expect(backLink.exists()).toBe(true);
			expect(backLink.text()).toContain("返回");
		});

		it("renders the tag posts header", async () => {
			const wrapper = await mountTagsPage({ routeQuery: { tag_id: "1" } });
			expect(wrapper.text()).toContain("标签文章");
		});

		it("renders post titles", async () => {
			const wrapper = await mountTagsPage({ routeQuery: { tag_id: "1" } });
			expect(wrapper.text()).toContain("Tagged Post One");
		});

		it("renders post excerpts", async () => {
			const wrapper = await mountTagsPage({ routeQuery: { tag_id: "1" } });
			expect(wrapper.text()).toContain("First tagged post excerpt.");
		});

		it("renders post category names", async () => {
			const wrapper = await mountTagsPage({ routeQuery: { tag_id: "1" } });
			expect(wrapper.text()).toContain("Tech");
		});

		it("renders post view counts", async () => {
			const wrapper = await mountTagsPage({ routeQuery: { tag_id: "1" } });
			expect(wrapper.text()).toContain("100 次阅读");
		});

		it("renders post links with correct hrefs", async () => {
			const wrapper = await mountTagsPage({ routeQuery: { tag_id: "1" } });
			const links = wrapper.findAll('a[href^="/posts/"]');
			expect(links.length).toBeGreaterThanOrEqual(1);
		});
	});

	describe("Empty tag posts", () => {
		it("renders empty state when tag has no posts", async () => {
			const wrapper = await mountTagsPage({
				routeQuery: { tag_id: "1" },
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
						title: "Tagged Post One",
						slug: "tagged-post-one",
						excerpt: "First tagged post excerpt.",
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

			vi.stubGlobal("useRoute", () => reactive({ query: { tag_id: "1" } }));

			vi.stubGlobal("useHead", vi.fn());

			vi.stubGlobal(
				"useFetch",
				vi.fn((url: string | (() => string) | { value: string }) => {
					const urlStr = typeof url === "function" ? url() : typeof url === "string" ? url : (url.value ?? "");
					if (urlStr.includes("/api/tags") && !urlStr.includes("/posts")) {
						return {
							data: ref(mockTags),
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

			const { default: TagsPage } = await import("@/pages/tags.vue");

			const SuspenseWrapper: any = {
				components: { TagsPage },
				template:
					"<Suspense>" +
					"<template #default><TagsPage /></template>" +
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

			// Verify navigateTo was called with tag_id and page 2
			expect(navigateToMock).toHaveBeenCalledWith({
				query: { tag_id: "1", page: 2 },
			});
		});
	});
});
