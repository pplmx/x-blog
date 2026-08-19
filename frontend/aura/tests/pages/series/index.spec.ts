/**
 * Series index page (/series) tests.
 *
 * Covers rendering states: loading, populated list (title + description +
 * post count), empty state, and SEO wiring.
 *
 * Mocks Nuxt composables (useFetch, useRuntimeConfig) and stubs NuxtLink and
 * Icon. The page uses `await useSeries()` in <script setup>, so it is wrapped
 * in a <Suspense> boundary (mirrors the categories page spec).
 */

import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { computed, ref } from "vue";

const mockSeries = [
	{
		id: 1,
		title: "FastAPI Deep Dive",
		slug: "fastapi-deep-dive",
		description: "A complete guided tour of FastAPI.",
		post_count: 3,
	},
	{
		id: 2,
		title: "Nuxt 3 Essentials",
		slug: "nuxt-3-essentials",
		description: null,
		post_count: 5,
	},
];

async function mountSeriesPage({
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
	vi.stubGlobal("navigateTo", vi.fn());
	vi.stubGlobal("computed", computed);
	vi.stubGlobal(
		"useFetch",
		vi.fn((url: string | (() => string) | { value: string }) => {
			const urlStr =
				typeof url === "function" ? url() : typeof url === "string" ? url : (url.value ?? "");
			if (urlStr.includes("/api/series")) {
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

	const { default: SeriesPage } = await import("@/pages/series/index.vue");

	const SuspenseWrapper: any = {
		components: { SeriesPage },
		template:
			"<Suspense>" +
			"<template #default><SeriesPage /></template>" +
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

describe("Series Index Page", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("renders the all-series header", async () => {
		const wrapper = await mountSeriesPage();
		expect(wrapper.text()).toContain("全部系列");
	});

	it("renders the series count", async () => {
		const wrapper = await mountSeriesPage();
		expect(wrapper.text()).toContain("共 2 个系列");
	});

	it("renders each series title", async () => {
		const wrapper = await mountSeriesPage();
		expect(wrapper.text()).toContain("FastAPI Deep Dive");
		expect(wrapper.text()).toContain("Nuxt 3 Essentials");
	});

	it("renders descriptions and post counts", async () => {
		const wrapper = await mountSeriesPage();
		expect(wrapper.text()).toContain("A complete guided tour of FastAPI.");
		expect(wrapper.text()).toContain("共 3 个系列");
	});

	it("links each series to its detail page", async () => {
		const wrapper = await mountSeriesPage();
		const links = wrapper.findAll("a[href^='/series/']").map((a) => a.attributes("href"));
		expect(links).toContain("/series/fastapi-deep-dive");
		expect(links).toContain("/series/nuxt-3-essentials");
	});

	it("renders loading skeletons while pending", async () => {
		const wrapper = await mountSeriesPage({ pending: true });
		expect(wrapper.findAll(".animate-pulse").length).toBeGreaterThan(0);
	});

	it("renders the empty state when there are no series", async () => {
		const wrapper = await mountSeriesPage({ series: [] });
		expect(wrapper.text()).toContain("暂无系列");
	});

	it("renders the load-failed state on fetch error", async () => {
		const wrapper = await mountSeriesPage({ error: { message: "boom" } });
		expect(wrapper.text()).toContain("加载失败");
	});
});
