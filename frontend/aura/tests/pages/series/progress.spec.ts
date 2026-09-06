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
	// getReaderSeriesProgress / getReaderSeriesFollows are the imperative
	// $fetch seams the page now uses from onMounted (TASK-220) — they resolve
	// to the raw payload, not a { data: { value } } AsyncData wrapper.
	const fetchProgress = vi.fn(async () => progress.value);
	const fetchFollows = vi.fn(async () => ({ items: [] as Array<{ id: number }>, total: 0 }));
	const followSeries = vi.fn();
	const unfollowSeries = vi.fn();
	const setNotify = vi.fn();
	return {
		mockSeries,
		progress,
		fetchProgress,
		fetchFollows,
		followSeries,
		unfollowSeries,
		setNotify,
		// Injected with a real Vue ref after imports: the series `data` the
		// useSeriesBySlug mock returns, so a test can SPA-navigate the page's
		// id-watch by swapping its value (the stale-response race, ISS-367).
		seriesRef: null as unknown as { value: typeof mockSeries | null },
	};
});

vi.mock("../../../api/public/series", () => ({
	useSeriesBySlug: () => ({
		data: h.seriesRef,
		pending: ref(false),
		error: ref(null),
	}),
}));

// Must be assigned before the page import below (which first triggers the mock
// factory); the ref is what the tests mutate to drive the page's series watch.
h.seriesRef = ref(h.mockSeries);
vi.mock("../../../api/reader/history", () => ({
	getReaderSeriesProgress: h.fetchProgress,
}));
vi.mock("../../../api/reader/follows", () => ({
	getReaderSeriesFollows: h.fetchFollows,
	followReaderSeries: h.followSeries,
	unfollowReaderSeries: h.unfollowSeries,
	setSeriesFollowNotify: h.setNotify,
}));

vi.mock("../../../composables/useSeo", () => ({ useSeo: vi.fn() }));

import SeriesPage from "../../../app/pages/series/[slug].vue";

const stubs = {
	Icon: { template: '<svg class="icon-stub" :data-icon="icon" />', props: ["icon"] },
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
		h.seriesRef.value = h.mockSeries;
		h.fetchProgress.mockClear();
		h.fetchFollows.mockClear();
		h.followSeries.mockClear();
		h.unfollowSeries.mockClear();
		h.setNotify.mockClear();
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

	it("marks read episodes with a check and highlights the up-next episode (ISS-379)", async () => {
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
		// Episode 1 (id 1) is read → a check badge, not its ordinal number.
		expect(wrapper.findAll('[data-icon="lucide:check"]').length).toBe(1);
		// Episode 2 is the up-next post → explicit "up next" highlight.
		expect(wrapper.text()).toContain("下一篇");
	});

	it("shows no reader progress for a guest", async () => {
		window.localStorage.removeItem("reader_token");
		const wrapper = await mountPage();
		expect(h.fetchProgress).not.toHaveBeenCalled();
		expect(wrapper.text()).not.toContain("阅读进度");
		// The read-marker mapping is progress-gated: no check badges, no up-next
		// highlights for a guest (ISS-379).
		expect(wrapper.findAll('[data-icon="lucide:check"]').length).toBe(0);
		expect(wrapper.text()).not.toContain("下一篇");
	});

	it("links the scoped series RSS feed (TASK-177)", async () => {
		const wrapper = await mountPage();
		expect(wrapper.find('a[href="/rss/series/tutorial.xml"]').exists()).toBe(true);
		expect(wrapper.text()).toContain("RSS 订阅");
	});

	it("toggles series new-part follow (TASK-178)", async () => {
		h.fetchFollows.mockResolvedValueOnce({
			items: [{ id: 1, title: "Tutorial", slug: "tutorial", notify: true }],
			total: 1,
		});
		const wrapper = await mountPage();
		expect(wrapper.text()).toContain("已关注新篇");

		// Unfollow
		await wrapper.find("button").trigger("click");
		expect(h.unfollowSeries).toHaveBeenCalledWith(1);
		expect(wrapper.text()).toContain("有新篇时通知我");

		// Follow again
		await wrapper.find("button").trigger("click");
		expect(h.followSeries).toHaveBeenCalledWith(1);
	});

	it("toggles new-part notifications without unfollowing (TASK-181)", async () => {
		h.fetchFollows.mockResolvedValueOnce({
			items: [{ id: 1, title: "Tutorial", slug: "tutorial", notify: true }],
			total: 1,
		});
		h.setNotify.mockResolvedValue({
			series_id: 1,
			series_slug: "tutorial",
			following: true,
			notify: false,
		});
		const wrapper = await mountPage();
		expect(wrapper.text()).toContain("通知已开");

		const notifyBtn = wrapper.findAll("button").find((b) => b.text() === "通知已开");
		expect(notifyBtn).toBeDefined();
		if (!notifyBtn) throw new Error("notify toggle not found");
		await notifyBtn.trigger("click");
		await flushPromises();

		expect(h.setNotify).toHaveBeenCalledWith(1, false);
		expect(h.unfollowSeries).not.toHaveBeenCalled();
		expect(wrapper.text()).toContain("通知已关");
		expect(wrapper.text()).toContain("已关注新篇"); // still followed
	});

	it("clamps the progress bar to 100% when read_count exceeds total (ISS-369)", async () => {
		// A post left the series after being read: read_count > total.
		h.progress.value = {
			series_slug: "tutorial",
			series_title: "Tutorial",
			total: 2,
			read_count: 5,
			completed: true,
			read_post_ids: [1, 2],
			next_slug: null,
		};
		const wrapper = await mountPage();
		// Unclamped this would be 250% — the bar must cap at the track width.
		expect(
			wrapper.find(".bg-gradient-to-r.from-indigo-500.to-violet-500").attributes("style"),
		).toContain("100%");
	});

	it("drops a stale progress response when a newer series is in flight (ISS-367)", async () => {
		// Slow (older) request for the first series — stays in flight.
		let resolveStale!: (v: unknown) => void;
		h.fetchProgress.mockImplementationOnce(
			() =>
				new Promise((res) => {
					resolveStale = res;
				}),
		);
		const wrapper = await mountPage(); // loadProgress #1 in flight, sequence 1

		// SPA-navigate to a second series: same component, id changes → the
		// keyed watch refires loadProgress (#2, fast) with the new progress.
		h.seriesRef.value = { ...h.mockSeries, id: 2, slug: "other", title: "Other Series" };
		h.progress.value = {
			series_slug: "other",
			series_title: "Other Series",
			total: 2,
			read_count: 2,
			completed: true,
			read_post_ids: [1, 2],
			next_slug: null,
		};
		await flushPromises();
		expect(wrapper.text()).toContain("已读 2 / 2");

		// The OLD response lands late with the first series' stale progress —
		// the seq guard must drop it, not clobber the live series.
		resolveStale({
			series_slug: "tutorial",
			series_title: "Tutorial",
			total: 2,
			read_count: 1,
			completed: false,
			read_post_ids: [1],
			next_slug: "ep-b",
		});
		await flushPromises();
		expect(wrapper.text()).toContain("已读 2 / 2");
		expect(wrapper.text()).not.toContain("已读 1 / 2");
	});

	it("drops a stale follow-state response so it can't clobber a newer toggle (ISS-374)", async () => {
		// The initial follow-state GET stays in flight (slow).
		let resolveStale!: (v: unknown) => void;
		h.fetchFollows.mockImplementationOnce(
			() =>
				new Promise((res) => {
					resolveStale = res;
				}),
		);
		const wrapper = await mountPage();

		// The reader follows while the stale GET is still in flight — the PUT
		// commits and flips the button to following.
		const followBtn = wrapper.find("button");
		await followBtn.trigger("click");
		await flushPromises();
		expect(wrapper.text()).toContain("已关注新篇");

		// The OLD GET (a pre-follow snapshot saying "not following") resolves
		// late — the seq guard must drop it, not flip the button back.
		resolveStale({ items: [], total: 0 });
		await flushPromises();
		expect(wrapper.text()).toContain("已关注新篇");
		expect(wrapper.text()).not.toContain("有新篇时通知我");
	});
});
