/**
 * Series detail page (/series/[slug]) tests.
 *
 * Covers rendering states: loading, populated detail (title, description,
 * ordered posts with position numbers), 404 (series null), and back link to
 * the index.
 *
 * Mocks Nuxt composables (useFetch, useRuntimeConfig, useRoute) and stubs
 * NuxtLink and Icon. The page uses `await useSeriesBySlug(...)` in <script
 * setup>, so it is wrapped in a <Suspense> boundary.
 */

import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { computed, ref } from "vue";

const mockSeries = {
	id: 1,
	title: "FastAPI Deep Dive",
	slug: "fastapi-deep-dive",
	description: "A complete guided tour of FastAPI.",
	post_count: 2,
	posts: [
		{
			id: 11,
			title: "Part One: Routing",
			slug: "fastapi-routing",
			excerpt: "Routing fundamentals.",
			published: true,
			created_at: "2024-06-01T10:00:00Z",
			views: 100,
			cover_image: null,
			category: { id: 1, name: "Tech" },
			tags: [],
			series: { id: 1, title: "FastAPI Deep Dive", slug: "fastapi-deep-dive" },
			series_order: 0,
		},
		{
			id: 12,
			title: "Part Two: Dependency Injection",
			slug: "fastapi-dependency-injection",
			excerpt: "Understanding DI.",
			published: true,
			created_at: "2024-06-08T10:00:00Z",
			views: 80,
			cover_image: null,
			category: { id: 1, name: "Tech" },
			tags: [],
			series: { id: 1, title: "FastAPI Deep Dive", slug: "fastapi-deep-dive" },
			series_order: 1,
		},
	],
};

const emptySeries = {
	...mockSeries,
	post_count: 0,
	posts: [],
};

async function mountSeriesDetailPage({
	series = mockSeries,
	pending = false,
	error = null,
}: {
	series?: typeof mockSeries | null;
	pending?: boolean;
	error?: { message: string } | null;
} = {}) {
	vi.stubGlobal("useRuntimeConfig", () => ({
		public: {
			apiUrl: "http://localhost:18888",
		},
	}));
	vi.stubGlobal("useHead", vi.fn());
	vi.stubGlobal("useRoute", () => ({
		params: { slug: "fastapi-deep-dive" },
		query: {},
	}));
	vi.stubGlobal("navigateTo", vi.fn());
	vi.stubGlobal("computed", computed);
	vi.stubGlobal(
		"useFetch",
		vi.fn((url: string | (() => string | null) | { value: string }) => {
			const urlStr =
				typeof url === "function" ? url() : typeof url === "string" ? url : (url.value ?? "");
			if (typeof urlStr === "string" && urlStr.includes("/api/series/")) {
				return {
					data: ref(series),
					pending: ref(pending),
					error: ref(error),
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

	const { default: SeriesDetailPage } = await import("@/pages/series/[slug].vue");

	const SuspenseWrapper: any = {
		components: { SeriesDetailPage },
		template:
			"<Suspense>" +
			"<template #default><SeriesDetailPage /></template>" +
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

describe("Series Detail Page", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("renders the back-to-all-series link", async () => {
		const wrapper = await mountSeriesDetailPage();
		const backLink = wrapper.find('a[href="/series"]');
		expect(backLink.exists()).toBe(true);
		expect(backLink.text()).toContain("返回");
	});

	it("renders the series title and add description", async () => {
		const wrapper = await mountSeriesDetailPage();
		expect(wrapper.text()).toContain("FastAPI Deep Dive");
		expect(wrapper.text()).toContain("A complete guided tour of FastAPI.");
	});

	it("renders each ordered post with its position number", async () => {
		const wrapper = await mountSeriesDetailPage();
		expect(wrapper.text()).toContain("Part One: Routing");
		expect(wrapper.text()).toContain("Part Two: Dependency Injection");
		// position badges 1 and 2
		expect(wrapper.findAll(".rounded-full").length).toBeGreaterThanOrEqual(2);
	});

	it("renders post view counts", async () => {
		const wrapper = await mountSeriesDetailPage();
		expect(wrapper.text()).toContain("100 次阅读");
	});

	it("links each post to its detail page in order", async () => {
		const wrapper = await mountSeriesDetailPage();
		const links = wrapper.findAll("a[href^='/posts/']").map((a) => a.attributes("href"));
		// ordered: posts rendered in series_order, so position 1 first
		expect(links).toEqual(["/posts/fastapi-routing", "/posts/fastapi-dependency-injection"]);
	});

	it("renders the not-found state when there is no series", async () => {
		const wrapper = await mountSeriesDetailPage({ series: null });
		expect(wrapper.text()).toContain("系列不存在");
	});

	it("renders loading skeletons while pending", async () => {
		const wrapper = await mountSeriesDetailPage({ pending: true });
		expect(wrapper.findAll(".animate-pulse").length).toBeGreaterThan(0);
	});

	it("renders a friendly load-failed state on fetch error", async () => {
		const wrapper = await mountSeriesDetailPage({
			error: { message: "network down" },
		});
		expect(wrapper.text()).toContain("加载失败");
		// ISS-135: never leak the raw backend/exception message to readers.
		expect(wrapper.text()).not.toContain("network down");
	});

	it("renders the empty state when a series has no posts", async () => {
		const wrapper = await mountSeriesDetailPage({ series: emptySeries });
		expect(wrapper.text()).toContain("暂无已发布文章");
	});

	it("omits the description block when a series has no description", async () => {
		const wrapper = await mountSeriesDetailPage({
			series: { ...mockSeries, description: null },
		});
		// title and posts still render; no description paragraph
		expect(wrapper.text()).toContain("FastAPI Deep Dive");
		expect(wrapper.text()).not.toContain("A complete guided tour of FastAPI.");
	});
});
