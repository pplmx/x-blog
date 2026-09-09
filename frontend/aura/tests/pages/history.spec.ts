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
const mockLoadFailed = ref(false);
const mockLoad = vi.fn();
const mockLoadMore = vi.fn();
// clear resolves true when the server copy is gone (or there was none to
// reach); resolves false when an offline clear left the server copy alive
// (ISS-387) — the page must then warn instead of claiming success.
const mockClear = vi.fn(async () => {
	mockHistory.value = [];
	mockStats.value = null;
	return true;
});
const mockHasMore = ref(false);
// Loading/busy/failure flags as shared refs so tests can drive the skeleton,
// spinner, load-more busy state and the load-more error independently.
const mockLoading = ref(false);
const mockServerEnabled = ref(false);
const mockLoadingMore = ref(false);
const mockLoadMoreError = ref(false);
const mockPendingDeviceCount = ref(0);
const mockImportLocalTrail = vi.fn();

vi.mock("../../composables/useReadingHistory", () => ({
	useReadingHistory: () => ({
		history: mockHistory,
		stats: mockStats,
		loading: mockLoading,
		loadFailed: mockLoadFailed,
		serverEnabled: mockServerEnabled,
		hasMore: mockHasMore,
		loadingMore: mockLoadingMore,
		loadMoreError: mockLoadMoreError,
		pendingDeviceCount: mockPendingDeviceCount,
		importLocalTrail: mockImportLocalTrail,
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
		mockLoading.value = false;
		mockServerEnabled.value = false;
		mockLoadingMore.value = false;
		mockLoadMoreError.value = false;
		mockPendingDeviceCount.value = 0;
		mockLoad.mockClear();
		mockLoadMore.mockClear();
		mockClear.mockClear();
		mockImportLocalTrail.mockClear();
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

	it("shows a labeled fallback + retry instead of the empty state when the server load failed (deep-dive)", async () => {
		// A transient server failure that falls back to an (empty) local trail
		// must NOT render the misleading "暂无阅读历史" empty state.
		mockLoadFailed.value = true;
		mockHistory.value = [];
		const wrapper = mountHistory();
		await flushPromises();

		expect(wrapper.text()).toContain("阅读历史加载失败，已临时显示本机记录。");
		expect(wrapper.text()).not.toContain("暂无阅读历史");

		// Retry re-runs the same load.
		const retry = wrapper.findAll("button").find((b) => b.text() === "重试");
		expect(retry).toBeDefined();
		retry?.trigger("click");
		expect(mockLoad).toHaveBeenCalled();
	});

	it("hides the fallback banner once the load is healthy again", () => {
		mockLoadFailed.value = false;
		mockHistory.value = [{ slug: "a", title: "Article A" }];
		const wrapper = mountHistory();
		expect(wrapper.text()).not.toContain("阅读历史加载失败");
		expect(wrapper.text()).toContain("Article A");
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

	it("single-flights clear and shows a busy, disabled confirm while the request is in flight", async () => {
		// The clear action issues a server DELETE when signed in; a fast double-click
		// on the red confirm button must not fire two DELETEs, and the reader needs
		// feedback that the clear started (the list stays visible until it resolves).
		let resolveClear: (v: boolean) => void;
		const pendingClear = new Promise<boolean>((resolve) => {
			resolveClear = resolve;
		});
		mockClear.mockReturnValue(pendingClear);
		mockHistory.value = [{ slug: "a", title: "Article A", viewedAt: Date.now() }];
		const wrapper = mountHistory();

		const headerClear = wrapper.findAll("button").filter((b) => b.text().includes("清空历史"));
		await headerClear[0].trigger("click");
		const confirmBtn = wrapper
			.find('[role="alert"]')
			.findAll("button")
			.find((b) => b.text().includes("清空历史"));
		expect(confirmBtn).toBeDefined();

		// Double-click while the clear is in flight: single-flight guard drops the
		// second invocation (deep-dive finding).
		await confirmBtn?.trigger("click");
		await confirmBtn?.trigger("click");
		await wrapper.vm.$nextTick();
		expect(mockClear).toHaveBeenCalledTimes(1);
		// The confirm button is disabled and shows busy feedback while awaiting.
		expect(confirmBtn?.attributes("disabled")).toBeDefined();
		expect(wrapper.find('[role="alert"]').text()).toContain("清空中");

		resolveClear?.(true);
		await flushPromises();
		expect(wrapper.text()).toContain("阅读历史已清空");
	});

	it("warns instead of claiming success when the server copy survives an offline clear (ISS-387)", async () => {
		vi.useFakeTimers();
		mockHistory.value = [{ slug: "a", title: "Article A", viewedAt: Date.now() }];
		mockClear.mockResolvedValueOnce(false);
		const wrapper = mountHistory();
		const headerClear = wrapper.findAll("button").filter((b) => b.text().includes("清空历史"));
		await headerClear[0].trigger("click");
		await wrapper
			.find('[role="alert"]')
			.findAll("button")
			.find((b) => b.text().includes("清空历史"))
			?.trigger("click");
		await wrapper.vm.$nextTick();
		// No green "cleared" claim — an amber warning that the copy will return.
		expect(wrapper.text()).not.toContain("阅读历史已清空");
		expect(wrapper.text()).toContain("联网后重新同步回来");
		// Same auto-dismiss as the success confirmation.
		await vi.advanceTimersByTimeAsync(4000);
		await flushPromises();
		expect(wrapper.text()).not.toContain("联网后重新同步回来");
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

	it("clears a pending recall-search debounce on unmount", async () => {
		vi.useFakeTimers();
		const wrapper = mountHistory();
		const input = wrapper.get('input[type="search"]');
		await input.setValue("rust");
		await vi.advanceTimersByTimeAsync(0); // flush the input dispatch
		// The 300ms debounce is now armed; leaving the page must cancel it so a
		// delayed load() can't fire against an unmounted component.
		wrapper.unmount();
		await vi.advanceTimersByTimeAsync(1000);
		await flushPromises();
		mockLoad.mock.calls.forEach((call) => {
			expect(call[0]).not.toBe("rust");
		});
		vi.useRealTimers();
	});

	it("shows loading skeletons on the first load (no rows yet) and a spinner over stale rows", async () => {
		mockLoading.value = true;
		mockHistory.value = [];
		const empty = mountHistory();
		expect(empty.findAll(".animate-pulse").length).toBeGreaterThan(0);

		mockHistory.value = [{ slug: "a", title: "Article A", viewedAt: Date.now() }];
		const stale = mountHistory();
		const spinner = stale.find('[role="status"]');
		expect(spinner.exists()).toBe(true);
		expect(stale.text()).toContain("正在加载历史");
	});

	it("load-more shows busy + an error line when the page fetch fails", () => {
		mockHasMore.value = true;
		mockLoadingMore.value = true;
		mockLoadMoreError.value = true;
		mockHistory.value = [{ slug: "a", title: "Article A", viewedAt: Date.now() }];
		const wrapper = mountHistory();
		// While a page is loading the button label swaps to the busy copy and the
		// action is disabled.
		const busyBtn = wrapper.findAll("button").find((b) => b.text().includes("正在加载历史"));
		expect(busyBtn?.attributes("disabled")).toBeDefined();
		// The failed-page error line is shown under the affordance.
		expect(wrapper.text()).toContain("网络错误");
	});

	describe("device-trail import offer (TASK-303/ISS-386)", () => {
		it("offers a one-time merge when the server history doesn't cover the device trail", () => {
			mockServerEnabled.value = true;
			mockPendingDeviceCount.value = 3;
			const wrapper = mountHistory();
			expect(wrapper.text()).toContain("发现 3 条此设备上的阅读记录");
			expect(wrapper.findAll("button").some((b) => b.text() === "导入记录")).toBe(true);
		});

		it("imports the pending trail and reports the imported count", async () => {
			mockServerEnabled.value = true;
			mockPendingDeviceCount.value = 3;
			mockImportLocalTrail.mockResolvedValue({ imported: 2 });
			const wrapper = mountHistory();
			const importBtn = wrapper.findAll("button").find((b) => b.text() === "导入记录");
			expect(importBtn).toBeDefined();
			await importBtn?.trigger("click");
			await flushPromises();
			expect(mockImportLocalTrail).toHaveBeenCalledTimes(1);
			expect(wrapper.text()).toContain("已导入 2 条记录");
			// A successful import stops offering the merge for this page view.
			const offer = wrapper.text().includes("发现 3 条此设备上的阅读记录");
			expect(offer).toBe(false);
		});

		it("reports when there was nothing new to import", async () => {
			mockServerEnabled.value = true;
			mockPendingDeviceCount.value = 1;
			mockImportLocalTrail.mockResolvedValue({ imported: 0 });
			const wrapper = mountHistory();
			const importBtn = wrapper.findAll("button").find((b) => b.text() === "导入记录");
			await importBtn?.trigger("click");
			await flushPromises();
			expect(wrapper.text()).toContain("没有可导入的新记录");
		});

		it("surfaces an import failure and allows a retry (re-arming the hide timer)", async () => {
			vi.useFakeTimers();
			mockServerEnabled.value = true;
			mockPendingDeviceCount.value = 1;
			mockImportLocalTrail.mockRejectedValue(new Error("offline"));
			const wrapper = mountHistory();
			const importBtn = () => wrapper.findAll("button").find((b) => b.text() === "导入记录");
			await importBtn()?.trigger("click");
			await flushPromises();
			expect(wrapper.text()).toContain("导入失败，请稍后重试");
			// The failure message replaces the offer for 4s; once it auto-clears the
			// offer returns, and a second tap re-runs the import — clearing the
			// previous hide timer in the process.
			await vi.advanceTimersByTimeAsync(4000);
			await flushPromises();
			expect(wrapper.findAll("button").some((b) => b.text() === "导入记录")).toBe(true);
			await importBtn()?.trigger("click");
			await flushPromises();
			expect(mockImportLocalTrail).toHaveBeenCalledTimes(2);
			expect(wrapper.text()).toContain("导入失败，请稍后重试");
			vi.useRealTimers();
		});

		it("dismisses the offer without importing", async () => {
			mockServerEnabled.value = true;
			mockPendingDeviceCount.value = 2;
			const wrapper = mountHistory();
			const dismiss = wrapper.findAll("button").find((b) => b.text() === "忽略");
			expect(dismiss).toBeDefined();
			await dismiss?.trigger("click");
			await flushPromises();
			expect(wrapper.text()).not.toContain("发现 2 条此设备上的阅读记录");
			expect(mockImportLocalTrail).not.toHaveBeenCalled();
		});
	});

	describe("date formatting edge cases", () => {
		it("falls back to 'recently viewed' for a legacy entry with an unparseable timestamp", () => {
			mockHistory.value = [{ slug: "a", title: "Article A", viewedAt: Number.NaN }];
			const wrapper = mountHistory();
			expect(wrapper.text()).toContain("最近浏览");
		});

		it("shows 'no record' when the latest activity timestamp cannot be parsed", () => {
			mockStats.value = {
				totalPosts: 4,
				totalReadingMinutes: 37,
				lastViewedAt: Number.NaN,
			};
			const wrapper = mountHistory();
			expect(wrapper.text()).toContain("最近阅读活动");
			expect(wrapper.text()).toContain("暂无记录");
		});
	});

	describe("heatmap shading bands", () => {
		it("shades cells by relative intensity across all four bands", () => {
			// Max activity = 10 → counts shade 0.1 (blue-200), 0.6 (indigo),
			// 1.0 (violet); a zero-count day stays neutral gray.
			mockStats.value = {
				totalPosts: 0,
				totalReadingMinutes: 0,
				activity: [
					{ date: "2026-08-30", count: 1 },
					{ date: "2026-08-31", count: 6 },
					{ date: "2026-09-01", count: 10 },
					{ date: "2026-09-02", count: 0 },
				],
			};
			const wrapper = mountHistory();
			expect(wrapper.text()).toContain("阅读活跃度（近一年）");
			const cells = wrapper.findAll("[aria-hidden='true']");
			expect(cells.length).toBeGreaterThan(0);
			// The max-count day's tooltip names the count.
			const titles = wrapper.findAll("[title]").map((el) => el.attributes("title"));
			expect(titles.some((t) => (t ?? "").includes("10 篇"))).toBe(true);
		});
	});
});
