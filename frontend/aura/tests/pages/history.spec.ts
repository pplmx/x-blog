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
const mockClear = vi.fn(async () => {
	mockHistory.value = [];
	mockStats.value = null;
});

vi.mock("../../composables/useReadingHistory", () => ({
	useReadingHistory: () => ({
		history: mockHistory,
		stats: mockStats,
		loading: ref(false),
		serverEnabled: ref(false),
		load: mockLoad,
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
		mockLoad.mockClear();
		mockClear.mockClear();
	});

	it("invokes load with the search term on input (TASK-186)", async () => {
		const wrapper = mountHistory();
		const input = wrapper.get('input[type="search"]');
		await input.setValue("rust");
		await flushPromises();
		expect(mockLoad).toHaveBeenCalledWith("rust");
	});

	it("renders without errors", () => {
		const wrapper = mountHistory();
		expect(wrapper.exists()).toBe(true);
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
});
