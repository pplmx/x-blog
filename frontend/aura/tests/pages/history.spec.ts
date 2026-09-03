/**
 * Reading-history page tests (DEC-114, TASK-169; DEC-116, TASK-170).
 *
 * Verifies the empty state, the newest-first history list with viewed
 * timestamps and continue-reading links, and the confirm/cancel/clear flow.
 * useReadingHistory and useSeo are mocked so tests control the trail
 * deterministically (the composable itself is covered by its own spec).
 */

import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import type { HistoryEntry, ReadingStats } from "../../composables/useReadingHistory";

const mockHistory = ref<HistoryEntry[]>([]);
const mockStats = ref<ReadingStats | null>(null);
const mockLoad = vi.fn();
const mockLoadMore = vi.fn();
const mockClear = vi.fn(async () => {
	mockHistory.value = [];
	mockStats.value = null;
});
const mockHasMore = ref(false);

vi.mock("../../composables/useReadingHistory", () => ({
	useReadingHistory: () => ({
		history: mockHistory,
		stats: mockStats,
		loading: ref(false),
		serverEnabled: ref(false),
		hasMore: mockHasMore,
		loadingMore: ref(false),
		loadMoreError: ref(false),
		load: mockLoad,
		loadMore: mockLoadMore,
		clear: mockClear,
	}),
}));

vi.mock("../../composables/useSeo", () => ({ useSeo: vi.fn() }));

import HistoryPage from "../../app/pages/history.vue";

const stubs = {
	Icon: {
		template: '<svg class="icon-stub" />',
	},
	NuxtLink: {
		template: '<a class="nuxt-link-stub"><slot/></a>',
	},
};

function mountHistory() {
	return mount(HistoryPage, { global: { stubs } });
}

describe("Reading-history page (TASK-170)", () => {
	beforeEach(() => {
		mockHistory.value = [];
		mockStats.value = null;
		mockHasMore.value = false;
		mockLoad.mockClear();
		mockLoadMore.mockClear();
		mockClear.mockClear();
	});

	it("invokes load with the search term after debounce (ISS-128)", async () => {
		vi.useFakeTimers();
		const wrapper = mountHistory();
		const input = wrapper.get('input[type="search"]');
		await input.setValue("rust");
		// happy-dom dispatches the input event as a queued macrotask; flush it
		// before advancing the fake clock so the debounce timer gets scheduled.
		await vi.advanceTimersByTimeAsync(0);
		await vi.advanceTimersByTimeAsync(350);
		await flushPromises();
		expect(mockLoad).toHaveBeenCalledWith("rust");
		vi.useRealTimers();
	});

	it("debounces rapid keystrokes into a single load call (ISS-128)", async () => {
		vi.useFakeTimers();
		const wrapper = mountHistory();
		const input = wrapper.get('input[type="search"]');
		mockLoad.mockClear(); // forget the onMounted no-arg load()
		await input.setValue("r");
		await vi.advanceTimersByTimeAsync(0); // flush input dispatch
		await vi.advanceTimersByTimeAsync(299); // still inside the debounce window
		await input.setValue("rust"); // supersedes the "r" term
		await vi.advanceTimersByTimeAsync(0); // flush input dispatch
		await vi.advanceTimersByTimeAsync(301); // now past the 300ms debounce
		await flushPromises();
		expect(mockLoad).toHaveBeenCalledTimes(1);
		expect(mockLoad).toHaveBeenCalledWith("rust");
		vi.useRealTimers();
	});

	it("renders without errors", () => {
		const wrapper = mountHistory();
		expect(wrapper.exists()).toBe(true);
	});

	it("exposes an accessible summary for the heatmap, cells aria-hidden (ISS-136)", async () => {
		mockStats.value = {
			totalPosts: 4,
			totalReadingMinutes: 40,
			lastViewedAt: 123,
			currentStreak: 2,
			longestStreak: 6,
			activity: [
				{ date: "2026-08-28", count: 1 },
				{ date: "2026-08-29", count: 3 },
			],
		};
		const wrapper = mountHistory();
		const heat = wrapper.find('[role="img"]');
		expect(heat.exists()).toBe(true);
		// Summary names the number of active days in the past year...
		expect(heat.attributes("aria-label")).toContain("天");
		// ...and the per-day cells are hidden from screen readers as noise.
		const cells = wrapper.findAll('[aria-hidden="true"]');
		expect(cells.length).toBeGreaterThan(0);
	});

	it("renders the empty state when there is no history", () => {
		const wrapper = mountHistory();
		expect(wrapper.text()).toContain("暂无阅读历史");
		expect(wrapper.text()).toContain("浏览文章");
	});

	it("lists history entries with title and continue-reading label", () => {
		mockHistory.value = [
			{ slug: "a", title: "Article A", viewedAt: Date.UTC(2024, 0, 15, 10, 30) },
			{ slug: "b", title: "Article B", viewedAt: Date.UTC(2024, 1, 1, 9, 0) },
		];
		const wrapper = mountHistory();
		expect(wrapper.text()).toContain("Article A");
		expect(wrapper.text()).toContain("Article B");
		expect(wrapper.text()).toContain("继续阅读");
		// Newest-first: the first entry is the most recently viewed.
		expect(wrapper.text().indexOf("Article A")).toBeLessThan(wrapper.text().indexOf("Article B"));
	});

	it("shows a localized viewed timestamp when available", () => {
		mockHistory.value = [
			{ slug: "a", title: "Article A", viewedAt: Date.UTC(2024, 0, 15, 10, 30) },
		];
		const wrapper = mountHistory();
		expect(wrapper.text()).toContain("2024");
	});

	it("falls back to the unviewed label for legacy entries without a timestamp", () => {
		mockHistory.value = [{ slug: "a", title: "Article A" }];
		const wrapper = mountHistory();
		expect(wrapper.text()).toContain("最近浏览");
	});

	it("shows reading-summary cards when stats are available (TASK-171)", () => {
		mockStats.value = { totalPosts: 4, totalReadingMinutes: 37 };
		const wrapper = mountHistory();
		expect(wrapper.text()).toContain("已读文章");
		expect(wrapper.text()).toContain("4");
		expect(wrapper.text()).toContain("阅读时长（分钟）");
		expect(wrapper.text()).toContain("37");
	});

	it("renders the latest-activity card with a localized datetime (TASK-197)", () => {
		mockStats.value = {
			totalPosts: 4,
			totalReadingMinutes: 37,
			lastViewedAt: Date.UTC(2026, 7, 24, 9, 15),
		};
		const wrapper = mountHistory();
		expect(wrapper.text()).toContain("最近阅读活动");
		expect(wrapper.text()).toContain("2026");
		expect(wrapper.text()).not.toContain("暂无记录");
	});

	it("shows a placeholder on the latest-activity card when there is no last read (TASK-197)", () => {
		mockStats.value = { totalPosts: 0, totalReadingMinutes: 0 };
		const wrapper = mountHistory();
		expect(wrapper.text()).toContain("最近阅读活动");
		expect(wrapper.text()).toContain("暂无记录");
	});

	it("renders the reading streak card with current and longest days (TASK-201)", () => {
		mockStats.value = {
			totalPosts: 4,
			totalReadingMinutes: 37,
			currentStreak: 3,
			longestStreak: 12,
		};
		const wrapper = mountHistory();
		expect(wrapper.text()).toContain("连续阅读");
		expect(wrapper.text()).toContain("3");
		expect(wrapper.text()).toContain("最长 12 天");
	});

	it("renders the 52-week activity heatmap with shaded day cells (TASK-201)", () => {
		mockStats.value = {
			totalPosts: 4,
			totalReadingMinutes: 37,
			activity: [
				{ date: "2026-08-22", count: 1 },
				{ date: "2026-08-23", count: 3 },
			],
		};
		const wrapper = mountHistory();
		expect(wrapper.text()).toContain("阅读活跃度（近一年）");
		// A day cell carries a tooltip with the date + localized count (padding
		// cells on the leading partial week have an empty title and are skipped).
		const tooltipCells = wrapper
			.findAll("[title]")
			.filter((el) => (el.attributes("title") ?? "") !== "");
		expect(tooltipCells.length).toBeGreaterThan(0);
		expect(tooltipCells[0].attributes("title")).toContain("篇");
	});

	it("hides the heatmap when there is no activity data (TASK-201)", () => {
		mockStats.value = { totalPosts: 0, totalReadingMinutes: 0 };
		const wrapper = mountHistory();
		expect(wrapper.text()).not.toContain("阅读活跃度（近一年）");
	});

	it("hides reading-summary cards when no stats (guests)", () => {
		const wrapper = mountHistory();
		expect(wrapper.text()).not.toContain("已读文章");
	});

	it("clears history only after confirmation", async () => {
		mockHistory.value = [{ slug: "a", title: "Article A", viewedAt: Date.now() }];
		const wrapper = mountHistory();
		expect(wrapper.text()).toContain("Article A");

		// The header "Clear history" button opens the inline confirmation alert.
		const headerClear = wrapper.findAll("button").filter((b) => b.text().includes("清空历史"));
		expect(headerClear.length).toBeGreaterThan(0);
		const alert = () => wrapper.find('[role="alert"]');

		// Cancel dismisses the confirmation without clearing.
		await headerClear[0].trigger("click");
		expect(alert().exists()).toBe(true);
		expect(alert().text()).toContain("此操作无法撤销");
		await alert()
			.findAll("button")
			.find((b) => b.text().includes("取消"))
			?.trigger("click");
		expect(mockClear).not.toHaveBeenCalled();
		expect(wrapper.text()).toContain("Article A");
		expect(alert().exists()).toBe(false);

		// Confirming within the alert clears the trail and shows the empty state.
		await headerClear[0].trigger("click");
		await alert()
			.findAll("button")
			.find((b) => b.text().includes("清空历史"))
			?.trigger("click");
		expect(mockClear).toHaveBeenCalled();
		await wrapper.vm.$nextTick();
		expect(wrapper.text()).toContain("暂无阅读历史");
	});

	it("shows a transient 'cleared' confirmation after clearing (deep-dive finding)", async () => {
		vi.useFakeTimers();
		mockHistory.value = [{ slug: "a", title: "Article A", viewedAt: Date.now() }];
		const wrapper = mountHistory();
		const headerClear = wrapper.findAll("button").filter((b) => b.text().includes("清空历史"));
		await headerClear[0].trigger("click");
		await wrapper
			.find('[role="alert"]')
			.findAll("button")
			.find((b) => b.text().includes("清空历史"))
			?.trigger("click");
		await wrapper.vm.$nextTick();
		expect(wrapper.text()).toContain("阅读历史已清空");
		// Auto-dismisses so the confirmation doesn't linger on the page.
		await vi.advanceTimersByTimeAsync(4000);
		await flushPromises();
		expect(wrapper.text()).not.toContain("阅读历史已清空");
		vi.useRealTimers();
	});

	it("loads older server history via a load-more affordance (bounded reachability, ISS-303)", async () => {
		mockHistory.value = [{ slug: "a", title: "Article A", viewedAt: Date.now() }];
		mockHasMore.value = true;
		const wrapper = mountHistory();
		const loadMore = wrapper.findAll("button").find((b) => b.text().includes("加载更多历史"));
		expect(loadMore).toBeDefined();
		await loadMore?.trigger("click");
		expect(mockLoadMore).toHaveBeenCalledTimes(1);
	});

	it("hides the load-more affordance when the server has no more pages", () => {
		mockHistory.value = [{ slug: "a", title: "Article A", viewedAt: Date.now() }];
		mockHasMore.value = false;
		const wrapper = mountHistory();
		expect(wrapper.findAll("button").some((b) => b.text().includes("加载更多历史"))).toBe(false);
	});
});
