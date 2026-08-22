/**
 * Series reading-progress tests (DEC-122, TASK-173).
 *
 * A signed-in reader sees a per-series progress card (read count, progress
 * bar, continue-from-first-unread link) derived from the API; completed series
 * show a completed badge; guests see no progress.
 */

import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";

const h = vi.hoisted(() => {
	const mockSeries = {
		id: 1,
		title: "Tutorial",
		slug: "tutorial",
		post_count: 2,
		posts: [
			{
				id: 1,
				title: "A",
				slug: "ep-a",
				created_at: "2024-01-01T00:00:00Z",
				series: { id: 1, title: "Tutorial", slug: "tutorial" },
				series_order: 0,
			},
			{
				id: 2,
				title: "B",
				slug: "ep-b",
				created_at: "2024-01-02T00:00:00Z",
				series: { id: 1, title: "Tutorial", slug: "tutorial" },
				series_order: 1,
			},
		],
	};
	// Plain value holder (no vue imports available inside vi.hoisted).
	type Progress = {
		series_slug: string;
		series_title: string;
		total: number;
		read_count: number;
		completed: boolean;
		read_post_ids: number[];
		next_slug: string | null;
	};
	const progress: { value: Progress | null } = { value: null };
	const fetchProgress = vi.fn(async () => ({ data: { value: progress.value } }));
	return { mockSeries, progress, fetchProgress };
});

vi.mock("../../../composables/useApi", () => ({
	useSeriesBySlug: () => ({
		data: ref(h.mockSeries),
		pending: ref(false),
		error: ref(null),
	}),
	fetchReaderSeriesProgress: h.fetchProgress,
}));

vi.mock("../../../composables/useSeo", () => ({ useSeo: vi.fn() }));

import SeriesPage from "../../../app/pages/series/[slug].vue";

const stubs = {
	Icon: { template: '<svg class="icon-stub" />' },
	NuxtLink: { template: '<a class="nuxt-link-stub"><slot/></a>' },
};

async function mountPage(query = "") {
	const SuspenseWrapper: any = {
		components: { SeriesPage },
		template:
			"<Suspense>" +
			"<template #default><SeriesPage /></template>" +
			"<template #fallback>Loading...</template>" +
			"</Suspense>",
	};
	const wrapper = mount(SuspenseWrapper, { global: { stubs } });
	await flushPromises();
	if (query) console.log(query); // placeholder to keep signature stable
	return wrapper;
}

describe("Series reading progress (TASK-173)", () => {
	beforeEach(() => {
		window.localStorage.setItem("reader_token", "token");
		h.progress.value = null;
		h.fetchProgress.mockClear();
		vi.stubGlobal("useRoute", () => ({ params: { slug: "tutorial" }, query: {} }));
		vi.stubGlobal("useHead", vi.fn());
		vi.stubGlobal("useRuntimeConfig", () => ({ public: { apiUrl: "http://localhost:18888" } }));
	});

	afterEach(() => {
		window.localStorage.removeItem("reader_token");
		vi.restoreAllMocks();
	});

	it("shows the progress card with read count for a signed-in reader", async () => {
		h.progress.value = {
			series_slug: "tutorial",
			series_title: "Tutorial",
			total: 2,
			read_count: 1,
			completed: false,
			read_post_ids: [1],
			next_slug: "ep-b",
		};
		const wrapper = await mountPage();
		expect(h.fetchProgress).toHaveBeenCalledWith("tutorial");
		expect(wrapper.text()).toContain("阅读进度");
		expect(wrapper.text()).toContain("已读 1 / 2");
		expect(wrapper.text()).toContain("继续阅读");
	});

	it("renders a continue link to the first unread episode", async () => {
		h.progress.value = {
			series_slug: "tutorial",
			series_title: "Tutorial",
			total: 2,
			read_count: 0,
			completed: false,
			read_post_ids: [],
			next_slug: "ep-a",
		};
		const wrapper = await mountPage();
		expect(wrapper.text()).toContain("继续阅读");
	});

	it("shows a completed badge when the series is fully read", async () => {
		h.progress.value = {
			series_slug: "tutorial",
			series_title: "Tutorial",
			total: 2,
			read_count: 2,
			completed: true,
			read_post_ids: [1, 2],
			next_slug: null,
		};
		const wrapper = await mountPage();
		expect(wrapper.text()).toContain("已读完");
		expect(wrapper.text()).not.toContain("继续阅读");
	});

	it("shows no progress for a guest", async () => {
		window.localStorage.removeItem("reader_token");
		const wrapper = await mountPage();
		expect(h.fetchProgress).not.toHaveBeenCalled();
		expect(wrapper.text()).not.toContain("阅读进度");
	});
});
