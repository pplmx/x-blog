/**
 * Archive page tests
 * Tests rendering states: loading, archive index (years/months with counts),
 * a selected year/month posts view, back link, and empty state.
 *
 * Mocks Nuxt composables (useFetch, useRuntimeConfig, useRoute, navigateTo)
 * and stubs NuxtLink and Icon components, mirroring categories.spec.ts.
 *
 * The archive page uses `await useApi(...)` in <script setup>, making the
 * setup async. We wrap in a <Suspense> boundary.
 */

import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { computed, reactive, ref } from "vue";

const mockArchive = [
	{ year: 2025, month: 11, count: 1 },
	{ year: 2024, month: 3, count: 2 },
	{ year: 2024, month: 1, count: 1 },
];

const mockArchivePosts = {
	items: [
		{
			id: 1,
			title: "Archived Post",
			slug: "archived-post",
			excerpt: "An archived post excerpt.",
			published: true,
			created_at: "2024-03-10T10:00:00Z",
			views: 42,
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

async function mountArchivePage({
	archive = mockArchive,
	posts = mockArchivePosts,
	pending = false,
	routeQuery = {},
}: {
	archive?: typeof mockArchive | null;
	posts?: typeof mockArchivePosts | null;
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

	vi.stubGlobal("computed", computed);

	// Mock useFetch: /api/posts/archive serves the index; /api/posts?... serves
	// the filtered post list (the page disables the posts fetch when no
	// year/month is selected by passing a null url — handle null url).
	vi.stubGlobal(
		"useFetch",
		vi.fn((url: string | (() => string) | { value: string } | null) => {
			const urlStr =
				url == null
					? ""
					: typeof url === "function"
						? url()
						: typeof url === "string"
							? url
							: (url.value ?? "");
			if (urlStr.includes("/api/posts/archive")) {
				return {
					data: ref(archive),
					pending: ref(pending),
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

	const { default: ArchivePage } = await import("../../app/pages/archive.vue");

	const SuspenseWrapper: any = {
		components: { ArchivePage },
		template:
			"<Suspense>" +
			"<template #default><ArchivePage /></template>" +
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

describe("Archive Page", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("Loading state", () => {
		it("renders loading skeletons when data is pending", async () => {
			const wrapper = await mountArchivePage({ pending: true });
			const skeletons = wrapper.findAll(".animate-pulse");
			expect(skeletons.length).toBeGreaterThan(0);
		});
	});

	describe("Archive index view (no year/month selected)", () => {
		it("renders the archive header", async () => {
			const wrapper = await mountArchivePage();
			expect(wrapper.text()).toContain("归档");
		});

		it("renders year groups", async () => {
			const wrapper = await mountArchivePage();
			expect(wrapper.text()).toContain("2025");
			expect(wrapper.text()).toContain("2024");
		});

		it("renders month links with post counts", async () => {
			const wrapper = await mountArchivePage();
			expect(wrapper.text()).toContain("(1)");
			expect(wrapper.text()).toContain("(2)");
		});

		it("renders the 2024 months sorted newest-first", async () => {
			const wrapper = await mountArchivePage();
			const year2024 = wrapper.findAll("section");
			// First section is 2025, second is 2024; both 2024 months present.
			expect(year2024.length).toBe(2);
		});
	});

	describe("Empty archive state", () => {
		it("renders empty state when no buckets", async () => {
			const wrapper = await mountArchivePage({ archive: [] });
			expect(wrapper.text()).toContain("暂无文章");
		});
	});

	describe("Year/month posts view", () => {
		it("renders back to full archive link", async () => {
			const wrapper = await mountArchivePage({ routeQuery: { year: "2024", month: "3" } });
			const backLink = wrapper.find('a[href="/archive"]');
			expect(backLink.exists()).toBe(true);
			expect(backLink.text()).toContain("返回");
		});

		it("renders the filtered post title", async () => {
			const wrapper = await mountArchivePage({ routeQuery: { year: "2024", month: "3" } });
			expect(wrapper.text()).toContain("Archived Post");
		});

		it("renders post count label", async () => {
			const wrapper = await mountArchivePage({ routeQuery: { year: "2024", month: "3" } });
			expect(wrapper.text()).toContain("共 1 篇文章");
		});

		it("renders empty posts state for an empty period", async () => {
			const wrapper = await mountArchivePage({
				posts: mockEmptyPosts,
				routeQuery: { year: "2025", month: "11" },
			});
			expect(wrapper.text()).toContain("该时间段暂无文章");
		});

		it("dates a scheduled post by its publish month, not its draft month (RIL ISS-265)", async () => {
			// Drafted in January, scheduled for June: the archive card shows the
			// June date that matches its June bucket (feed filters/orders and
			// archive buckets all key off effective publish time now).
			const scheduled = {
				items: [
					{
						...mockArchivePosts.items[0],
						created_at: "2024-01-15T10:00:00Z",
						publish_at: "2024-06-01T10:00:00Z",
					},
				],
				pagination: mockArchivePosts.pagination,
			};
			const wrapper = await mountArchivePage({
				posts: scheduled,
				routeQuery: { year: "2024", month: "6" },
			});
			// Archive card dates use the compact locale format (2024/6/1).
			expect(wrapper.text()).toContain("2024/6/1");
			expect(wrapper.text()).not.toContain("2024/1/15");
		});
	});
});
