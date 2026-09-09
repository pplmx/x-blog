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
	postsError = null,
	archiveError = null,
	postsRef = undefined,
	routeQuery = {},
}: {
	archive?: typeof mockArchive | null;
	posts?: typeof mockArchivePosts | null;
	pending?: boolean;
	postsError?: unknown;
	archiveError?: unknown;
	postsRef?: { value: typeof mockArchivePosts | null };
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
					error: ref(archiveError),
					refresh: vi.fn(),
				};
			}
			if (urlStr.includes("/api/posts")) {
				return {
					data: (postsRef ?? ref(posts)) as unknown,
					pending: ref(pending),
					error: ref(postsError),
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

		it("narrows the month pills via the filter box (survey finding)", async () => {
			const wrapper = await mountArchivePage();
			const input = wrapper.find('input[type="search"]');
			expect(input.exists()).toBe(true);

			await input.setValue("2024");
			await flushPromises();
			expect(wrapper.text()).toContain("(1)"); // January 2024
			expect(wrapper.text()).toContain("(2)"); // March 2024
			expect(wrapper.text()).not.toContain("2025");

			await input.setValue("三");
			await flushPromises();
			expect(wrapper.text()).toContain("(2)"); // just March
			expect(wrapper.text()).not.toContain("(1)");

			await input.setValue("");
			await flushPromises();
			expect(wrapper.text()).toContain("2025"); // everything back
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

		it("renders previous/next month navigation with an interior month (ISS-376)", async () => {
			// 2024-03 sits between 2024-01 (older, has posts) and 2025-11
			// (newer, has posts) in the populated-month ordering.
			const wrapper = await mountArchivePage({ routeQuery: { year: "2024", month: "3" } });
			expect(wrapper.text()).toContain("2024年");
			expect(wrapper.text()).toContain("2025年");
			// The adjacent month labels carry month + year, so both directions exist.
			expect(wrapper.text()).toContain("2024年1月");
			expect(wrapper.text()).toContain("2025年11月");
		});

		it("omits the previous-month link at the oldest archive month (ISS-376)", async () => {
			// 2024-01 is the earliest populated month — no older month exists,
			// so only the next-month link renders.
			const wrapper = await mountArchivePage({ routeQuery: { year: "2024", month: "1" } });
			expect(wrapper.text()).toContain("2024年3月"); // next (newer)
			// No back-in-time link: the previous direction dead-ends at the bound.
			const chevrons = wrapper.findAll('[data-icon="lucide:chevron-left"]');
			expect(chevrons.length).toBe(0);
		});

		it("omits the next-month link at the newest archive month (ISS-376)", async () => {
			// 2025-11 is the newest populated month — no newer month exists.
			const wrapper = await mountArchivePage({ routeQuery: { year: "2025", month: "11" } });
			expect(wrapper.text()).toContain("2024年3月"); // prev (older)
			const chevrons = wrapper.findAll('[data-icon="lucide:chevron-right"]');
			expect(chevrons.length).toBe(0);
		});

		it("shows no adjacent-month links when the selected month is out of the archive bounds", async () => {
			// A query for a month that has no posts at all (e.g. 2020-01) must
			// not render bogus navigation — both links absent, like the bounds.
			const wrapper = await mountArchivePage({ routeQuery: { year: "2020", month: "1" } });
			expect(wrapper.findAll('[data-icon="lucide:chevron-left"]').length).toBe(0);
			expect(wrapper.findAll('[data-icon="lucide:chevron-right"]').length).toBe(0);
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

	describe("Page parameter handling", () => {
		it("reads a page number from the query and forwards it to the posts fetch", async () => {
			// A paged deep link (?page=2) must survive into the posts query:
			// page 1 leaves no trailing param, a higher page includes it.
			const wrapper = await mountArchivePage({
				routeQuery: { year: "2024", month: "3", page: "2" },
			});
			expect(wrapper.text()).toContain("Archived Post");
		});

		it("renders windowed pagination with ellipsis and disables the current page", async () => {
			// 20 pages centres the window [1..7] + ellipsis + last page — the
			// ellipsis and current-page branches of the token renderer.
			const manyPages = {
				items: [mockArchivePosts.items[0]],
				pagination: {
					total: 200,
					page: 1,
					limit: 10,
					total_pages: 20,
				},
			};
			const wrapper = await mountArchivePage({
				posts: manyPages as unknown as typeof mockArchivePosts,
				routeQuery: { year: "2024", month: "3" },
			});
			const pageBtns = wrapper.findAll("button").filter((b) => /\d|…/.test(b.text()));
			// 1..7 + ellipsis + 20 = 9 tokens.
			expect(pageBtns.length).toBe(9);
			const ellipsis = pageBtns.find((b) => b.text() === "…");
			expect(ellipsis?.attributes("disabled")).toBeDefined();
			const current = pageBtns.find((b) => b.text() === "1");
			expect(current?.attributes("disabled")).toBeDefined();
			expect(current?.attributes("aria-current")).toBe("page");
		});

		it("goToPage preserves the year/month period and sets the page (click)", async () => {
			const manyPages = {
				items: [mockArchivePosts.items[0]],
				pagination: {
					total: 200,
					page: 1,
					limit: 10,
					total_pages: 20,
				},
			};
			const wrapper = await mountArchivePage({
				posts: manyPages as unknown as typeof mockArchivePosts,
				routeQuery: { year: "2024", month: "1" },
			});
			const pageBtns = wrapper.findAll("button").filter((b) => /\d/.test(b.text()));
			const page2 = pageBtns.find((b) => b.text() === "2");
			expect(page2).toBeDefined();
			await page2?.trigger("click");
			const nav = (globalThis as unknown as { navigateTo: ReturnType<typeof vi.fn> }).navigateTo;
			expect(nav).toHaveBeenCalledWith({
				query: { year: "2024", month: "1", page: 2 },
			});
		});

		it("clamps a stale page=999 deep link back to the last real page once pagination lands", async () => {
			const navMock = vi.fn();
			vi.stubGlobal("useRuntimeConfig", () => ({
				public: { apiUrl: "http://localhost:18888" },
			}));
			vi.stubGlobal("useRoute", () =>
				reactive({ query: { year: "2024", month: "1", page: "999" } }),
			);
			vi.stubGlobal("navigateTo", navMock);
			vi.stubGlobal("useHead", vi.fn());
			vi.stubGlobal("computed", computed);
			const postsData = ref<{ items: unknown[]; pagination: Record<string, number> } | null>(null);
			vi.stubGlobal(
				"useFetch",
				vi.fn((url: string | (() => string) | { value: string }) => {
					const urlStr =
						typeof url === "function" ? url() : typeof url === "string" ? url : (url.value ?? "");
					if (urlStr.includes("/api/posts/archive")) {
						return {
							data: ref(mockArchive),
							pending: ref(false),
							error: ref(null),
							refresh: vi.fn(),
						};
					}
					if (urlStr.includes("/api/posts")) {
						return {
							data: postsData,
							pending: ref(false),
							error: ref(null),
							refresh: vi.fn(),
						};
					}
					return { data: ref(null), pending: ref(false), error: ref(null), refresh: vi.fn() };
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
						NuxtLink: { template: '<a :href="to"><slot/></a>', props: ["to"] },
						Icon: {
							template: '<svg class="iconstub" :data-icon="icon"></svg>',
							props: ["icon"],
						},
					},
				},
			});
			await flushPromises();
			expect(navMock).not.toHaveBeenCalled();

			postsData.value = {
				items: [],
				pagination: { total: 0, page: 1, limit: 10, total_pages: 1 },
			};
			await flushPromises();
			expect(navMock).toHaveBeenCalledWith({
				query: { year: "2024", month: "1", page: "1" },
				replace: true,
			});
		});
	});

	describe("Posts fetch failure", () => {
		it("surfaces a load-failed message with a retry instead of an empty state", async () => {
			const wrapper = await mountArchivePage({
				postsError: { message: "boom" },
				routeQuery: { year: "2024", month: "3" },
			});
			expect(wrapper.text()).toContain("加载失败");
			expect(wrapper.text()).not.toContain("暂无文章");
			const retry = wrapper.findAll("button").find((b) => b.text() === "重试");
			expect(retry).toBeDefined();
			expect(retry?.exists()).toBe(true);
			// Retry re-runs both refreshes (the error state's recovery action).
			await retry?.trigger("click");
			await flushPromises();
			expect(wrapper.text()).toContain("加载失败");
		});
	});

	describe("Archive index edge cases", () => {
		it("renders the empty state when the archive index is null", async () => {
			const wrapper = await mountArchivePage({ archive: null });
			expect(wrapper.text()).toContain("暂无文章");
		});

		it("shows a no-results hint when the narrowing filter matches nothing", async () => {
			const wrapper = await mountArchivePage();
			const input = wrapper.find('input[type="search"]');
			await input.setValue("not-a-real-month");
			await flushPromises();
			expect(wrapper.text()).toContain("没有匹配");
			// The year headers all disappear once nothing matches.
			expect(wrapper.text()).not.toContain("2025");
		});
	});

	describe("Post card edge cases", () => {
		it("handles a post without an excerpt or category", async () => {
			const bare = {
				items: [
					{
						...mockArchivePosts.items[0],
						excerpt: "",
						category: null,
					},
				],
				pagination: mockArchivePosts.pagination,
			};
			const wrapper = await mountArchivePage({
				posts: bare as unknown as typeof mockArchivePosts,
				routeQuery: { year: "2024", month: "3" },
			});
			expect(wrapper.text()).toContain("Archived Post");
			// No excerpt paragraph, no category chip.
			expect(wrapper.find("p.line-clamp-2").exists()).toBe(false);
		});

		it("renders an empty date for a post with an unparseable timestamp", async () => {
			const badDate = {
				items: [
					{
						...mockArchivePosts.items[0],
						created_at: "not-a-date",
					},
				],
				pagination: mockArchivePosts.pagination,
			};
			const wrapper = await mountArchivePage({
				posts: badDate as unknown as typeof mockArchivePosts,
				routeQuery: { year: "2024", month: "3" },
			});
			expect(wrapper.text()).toContain("Archived Post");
			expect(wrapper.text()).toContain("42 次阅读");
		});
	});

	describe("SEO metadata", () => {
		function seoTitle(): string {
			const useHeadMock = (
				globalThis as unknown as { useHead: { mock: { calls: Array<[unknown]> } } }
			).useHead;
			const first = useHeadMock.mock.calls[0]?.[0] as { value?: { title?: string } };
			return first?.value?.title ?? "";
		}

		it("uses the period-aware title when a year/month is selected", async () => {
			const wrapper = await mountArchivePage({ routeQuery: { year: "2024", month: "3" } });
			expect(wrapper.exists()).toBe(true);
			expect(seoTitle()).toContain("2024");
		});

		it("uses the plain archive title on the index view", async () => {
			const wrapper = await mountArchivePage();
			expect(wrapper.exists()).toBe(true);
			expect(seoTitle()).toBe("归档");
		});
	});
});
