/**
 * Admin editorial calendar page tests (DEC-162, TASK-194).
 *
 * Verifies the Monday-first month grid: title/header, 42 day cells, a post
 * chip landing on its local date cell with the right status color + editor
 * deep-link, undated drafts confined to the sidebar, and prev/next/today
 * month navigation re-issuing the API call with the shifted month.
 */

import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { reactive } from "vue";

vi.stubGlobal("definePageMeta", vi.fn());
vi.stubGlobal("useHead", vi.fn());
vi.stubGlobal("navigateTo", vi.fn());

// Pin the page to June 2026 so day-cell assertions are deterministic.
const routeQuery = { month: "2026-06" };
vi.stubGlobal("useRoute", () => reactive({ query: routeQuery }));

const mockFetch = vi.fn();
vi.mock("../../api/admin/calendar", () => ({
	getAdminCalendar: mockFetch,
}));

const stubs = {
	Icon: { template: '<svg class="icon-stub" />' },
	NuxtLink: { template: "<a><slot /></a>" },
};

let CalendarPage: unknown;
async function mountPage() {
	CalendarPage = CalendarPage ?? (await import("../../app/pages/admin/calendar.vue")).default;
	const wrapper = mount(CalendarPage as never, {
		global: { stubs },
	});
	await flushPromises();
	return wrapper;
}

/** A naive-UTC ISO string whose instant maps to the SAME local day we specify. */
function noonLocalIso(year: number, month: number, day: number): string {
	return new Date(year, month - 1, day, 12, 0).toISOString().slice(0, 19);
}

afterEach(() => {
	vi.unstubAllGlobals();
	vi.clearAllMocks();
	vi.stubGlobal("definePageMeta", vi.fn());
	vi.stubGlobal("useHead", vi.fn());
	vi.stubGlobal("navigateTo", vi.fn());
	vi.stubGlobal("useRoute", () => reactive({ query: routeQuery }));
});

describe("Admin calendar page (TASK-194)", () => {
	beforeEach(() => {
		routeQuery.month = "2026-06";
		mockFetch.mockReset();
		mockFetch.mockResolvedValue({ month: "2026-06", items: [], unscheduled: [] });
	});

	it("renders the title, header and a 42-cell month grid", async () => {
		const wrapper = await mountPage();
		expect(wrapper.text()).toContain("内容日历");
		expect(wrapper.find('[data-testid="calendar-header"]').exists()).toBe(true);
		expect(wrapper.findAll('[data-testid="calendar-day"]')).toHaveLength(42);
		expect(mockFetch).toHaveBeenCalledWith("2026-06");
	});

	it("places a published post on its local day cell with a green chip and editor link", async () => {
		const date = noonLocalIso(2026, 6, 15);
		mockFetch.mockResolvedValue({
			month: "2026-06",
			items: [
				{ id: 7, title: "Live post", slug: "live", type: "published", date, published: true },
			],
			unscheduled: [],
		});
		const wrapper = await mountPage();
		const chip = wrapper.find(
			'[data-testid="calendar-day"][data-date$="06-15"] a[data-testid="calendar-post-chip"]',
		);
		expect(chip.exists()).toBe(true);
		expect(chip.text()).toBe("Live post");
		expect(chip.attributes("href")).toBe("/admin/posts/7");
		expect(chip.element.className).toContain("bg-emerald-100");
	});

	it("colors scheduled posts amber", async () => {
		const date = noonLocalIso(2026, 6, 16);
		mockFetch.mockResolvedValue({
			month: "2026-06",
			items: [{ id: 9, title: "Scheduled", slug: "s", type: "scheduled", date, published: true }],
			unscheduled: [],
		});
		const wrapper = await mountPage();
		const chip = wrapper.find('[data-testid="calendar-day"] a[data-testid="calendar-post-chip"]');
		expect(chip.text()).toBe("Scheduled");
		expect(chip.element.className).toContain("bg-amber-100");
	});

	it("keeps undated drafts in the sidebar, not on the grid", async () => {
		mockFetch.mockResolvedValue({
			month: "2026-06",
			items: [],
			unscheduled: [
				{ id: 3, title: "No date yet", slug: "nd", type: "draft", date: null, published: false },
			],
		});
		const wrapper = await mountPage();
		expect(wrapper.text()).toContain("No date yet");
		expect(
			wrapper.findAll('[data-testid="calendar-day"] a[data-testid="calendar-post-chip"]'),
		).toHaveLength(0);
	});

	it("ignores posts dated far outside the month grid", async () => {
		mockFetch.mockResolvedValue({
			month: "2026-06",
			items: [
				{
					id: 5,
					title: "Way out",
					slug: "out",
					type: "draft",
					date: "2030-01-01T12:00:00",
					published: false,
				},
			],
			unscheduled: [],
		});
		const wrapper = await mountPage();
		// 42 cells span ~mid-May..mid-June; Jan 2030 maps to no cell.
		expect(wrapper.text()).not.toContain("Way out");
	});

	it("navigates to the shifted month on next/prev", async () => {
		const wrapper = await mountPage();
		const navigateToMock = vi.mocked(globalThis.navigateTo);
		const next = wrapper.findAll("button").find((b) => b.text().includes("下月"));
		await next?.trigger("click");
		expect(navigateToMock).toHaveBeenCalledWith(
			expect.objectContaining({ query: expect.objectContaining({ month: "2026-07" }) }),
		);
		navigateToMock.mockClear();
		const prev = wrapper.findAll("button").find((b) => b.text().includes("上月"));
		await prev?.trigger("click");
		expect(navigateToMock).toHaveBeenCalledWith(
			expect.objectContaining({ query: expect.objectContaining({ month: "2026-05" }) }),
		);
	});

	it("exposes the month grid as a labelled table, not an unlabeled wall of numbers (ISS-212)", async () => {
		const wrapper = await mountPage();
		const table = wrapper.find('[role="table"]');
		expect(table.exists()).toBe(true);

		// aria-labelledby resolves to the month <h2>, so SR announces the month.
		const labelId = table.attributes("aria-labelledby");
		expect(labelId).toBe("calendar-month-title");
		expect(wrapper.find(`#${labelId}`).exists()).toBe(true);

		// 7 weekday columnheaders and a header row + 6 week rows.
		expect(wrapper.findAll('[role="columnheader"]')).toHaveLength(7);
		expect(wrapper.findAll('[role="row"]')).toHaveLength(7);
		expect(wrapper.findAll('[role="cell"]')).toHaveLength(42);

		// Each day cell carries full-date context, not just the visible number.
		const first = wrapper.findAll('[role="cell"]')[0];
		expect(first.attributes("aria-label") ?? "").toContain("2026");
	});

	it("announces the post count inside a day cell label (ISS-212)", async () => {
		const date = noonLocalIso(2026, 6, 15);
		mockFetch.mockResolvedValue({
			month: "2026-06",
			items: [
				{ id: 7, title: "Live post", slug: "live", type: "published", date, published: true },
				{ id: 8, title: "Second", slug: "two", type: "draft", date, published: false },
			],
			unscheduled: [],
		});
		const wrapper = await mountPage();
		const label = wrapper.find('[role="cell"][data-date$="06-15"]').attributes("aria-label") ?? "";
		expect(label).toContain("2026");
		expect(label).toContain("2 篇文章");
	});
});
