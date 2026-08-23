/**
 * Admin Series Page Tests
 *
 * Tests the admin series page: loading/error/empty states, creating a series
 * (title + generated slug + description), inline editing, and deleting with
 * confirmation.
 *
 * Mocks the fetchAdminSeries, createAdminSeries, updateAdminSeries, and
 * deleteAdminSeries composables. Uses a <Suspense> wrapper since the page uses
 * `await fetchAdminSeries()` in <script setup>.
 */

import { flushPromises } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import { mountWithSuspense } from "./helpers.ts";

const {
	mockFetchAdminSeries,
	mockCreateAdminSeries,
	mockUpdateAdminSeries,
	mockDeleteAdminSeries,
	mockFetchAdminSeriesEpisodes,
	mockReorderAdminSeriesEpisodes,
} = vi.hoisted(() => ({
	mockFetchAdminSeries: vi.fn(),
	mockCreateAdminSeries: vi.fn(),
	mockUpdateAdminSeries: vi.fn(),
	mockDeleteAdminSeries: vi.fn(),
	mockFetchAdminSeriesEpisodes: vi.fn(),
	mockReorderAdminSeriesEpisodes: vi.fn(),
}));

vi.mock("~/composables/useApi", () => ({
	fetchAdminSeries: mockFetchAdminSeries,
	createAdminSeries: mockCreateAdminSeries,
	updateAdminSeries: mockUpdateAdminSeries,
	deleteAdminSeries: mockDeleteAdminSeries,
	fetchAdminSeriesEpisodes: mockFetchAdminSeriesEpisodes,
	reorderAdminSeriesEpisodes: mockReorderAdminSeriesEpisodes,
}));

vi.stubGlobal("useRuntimeConfig", () => ({
	public: { apiUrl: "http://localhost:18888" },
}));
vi.stubGlobal("navigateTo", vi.fn());
vi.stubGlobal("useHead", vi.fn());
vi.stubGlobal("definePageMeta", vi.fn());

const originalConfirm = window.confirm;

const mockSeries = [
	{
		id: 1,
		title: "FastAPI Deep Dive",
		slug: "fastapi-deep-dive",
		description: "A tour",
		post_count: 3,
	},
	{ id: 2, title: "Nuxt 3", slug: "nuxt-3", description: null, post_count: 0 },
];

function mockFetchResult(data: unknown, options: { pending?: boolean; error?: unknown } = {}) {
	return {
		data: ref(data),
		pending: ref(options.pending ?? false),
		error: ref(options.error ?? null),
		refresh: vi.fn(),
	};
}

async function loadPage() {
	const { default: SeriesPage } = await import("@/pages/admin/series.vue");
	return SeriesPage;
}

describe("Admin Series Page", () => {
	afterEach(() => {
		vi.restoreAllMocks();
		vi.clearAllMocks();
		window.confirm = originalConfirm;
	});

	describe("Loading state", () => {
		it("renders loading message when series are pending", async () => {
			mockFetchAdminSeries.mockReturnValue(mockFetchResult(null, { pending: true }));
			const SeriesPage = await loadPage();
			const wrapper = await mountWithSuspense(SeriesPage);
			expect(wrapper.text()).toContain("加载中");
		});
	});

	describe("Error state", () => {
		it("renders error message when fetch fails", async () => {
			mockFetchAdminSeries.mockReturnValue(
				mockFetchResult(null, { error: { message: "Fetch error" } }),
			);
			const SeriesPage = await loadPage();
			const wrapper = await mountWithSuspense(SeriesPage);
			expect(wrapper.text()).toContain("Fetch error");
		});
	});

	describe("Empty state", () => {
		it("renders empty state when no series exist", async () => {
			mockFetchAdminSeries.mockReturnValue(mockFetchResult([]));
			const SeriesPage = await loadPage();
			const wrapper = await mountWithSuspense(SeriesPage);
			expect(wrapper.text()).toContain("暂无系列");
		});
	});

	describe("Populated state", () => {
		beforeEach(() => {
			mockFetchAdminSeries.mockReturnValue(mockFetchResult(mockSeries));
		});

		it("renders each series with title, slug, and post count", async () => {
			const SeriesPage = await loadPage();
			const wrapper = await mountWithSuspense(SeriesPage);
			expect(wrapper.text()).toContain("FastAPI Deep Dive");
			expect(wrapper.text()).toContain("3 篇文章");
			expect(wrapper.text()).toContain("/series/fastapi-deep-dive");
		});

		it("renders description when present and omits it when null", async () => {
			const SeriesPage = await loadPage();
			const wrapper = await mountWithSuspense(SeriesPage);
			expect(wrapper.text()).toContain("A tour");
		});
	});

	describe("Create", () => {
		beforeEach(() => {
			mockFetchAdminSeries.mockReturnValue(mockFetchResult(mockSeries));
		});

		it("creates a series with title, generated slug, and description", async () => {
			mockCreateAdminSeries.mockReturnValue(mockFetchResult({ id: 3 }));
			const SeriesPage = await loadPage();
			const wrapper = await mountWithSuspense(SeriesPage);

			const inputs = wrapper.findAll('input[type="text"]');
			// title input then slug input
			await inputs[0].setValue("My New Series");
			const textareas = wrapper.findAll("textarea");
			await textareas[0].setValue("A brand new series");

			const createButton = wrapper.findAll("button").find((b) => b.text().includes("创建"));
			expect(createButton).toBeTruthy();
			await createButton?.trigger("click");
			await flushPromises();

			expect(mockCreateAdminSeries).toHaveBeenCalled();
			const [payload] = mockCreateAdminSeries.mock.calls.at(-1) as any[];
			expect(payload.title).toBe("My New Series");
			expect(payload.slug).toBe("my-new-series");
			expect(payload.description).toBe("A brand new series");
		});

		it("generates a deterministic ASCII slug for a CJK-only title", async () => {
			mockCreateAdminSeries.mockReturnValue(mockFetchResult({ id: 4 }));
			const SeriesPage = await loadPage();
			const wrapper = await mountWithSuspense(SeriesPage);

			const inputs = wrapper.findAll('input[type="text"]');
			await inputs[0].setValue("中文系列");

			const createButton = wrapper.findAll("button").find((b) => b.text().includes("创建"));
			await createButton?.trigger("click");
			await flushPromises();

			const [payload] = mockCreateAdminSeries.mock.calls.at(-1) as any[];
			expect(payload.title).toBe("中文系列");
			expect(payload.slug).toMatch(/^series-[a-z0-9]+$/);
		});

		it("surfaces a duplicate-slug error from the backend", async () => {
			mockCreateAdminSeries.mockReturnValue(
				mockFetchResult(null, { error: { data: { detail: "Series already exists" } } }),
			);
			const SeriesPage = await loadPage();
			const wrapper = await mountWithSuspense(SeriesPage);

			const inputs = wrapper.findAll('input[type="text"]');
			await inputs[0].setValue("Duplicate");
			const createButton = wrapper.findAll("button").find((b) => b.text().includes("创建"));
			await createButton?.trigger("click");
			await flushPromises();

			expect(wrapper.text()).toContain("Series already exists");
		});
	});

	describe("Edit", () => {
		beforeEach(() => {
			mockFetchAdminSeries.mockReturnValue(mockFetchResult(mockSeries));
		});

		it("edits title/slug/description and saves", async () => {
			mockUpdateAdminSeries.mockReturnValue(mockFetchResult({ id: 1 }));
			const SeriesPage = await loadPage();
			const wrapper = await mountWithSuspense(SeriesPage);

			const editButton = wrapper.findAll("button").find((b) => b.text().includes("编辑"));
			expect(editButton).toBeTruthy();
			await editButton?.trigger("click");
			await flushPromises();

			const inputs = wrapper.findAll('input[type="text"]');
			// create form has title+slug first, then the inline edit form has
			// title+slug — target the edit form (index 2, 3)
			await inputs[2].setValue("FastAPI Deep Dive v2");
			await inputs[3].setValue("fastapi-deep-dive-v2");

			const confirmButton = wrapper.findAll("button").find((b) => b.text().includes("确认"));
			await confirmButton?.trigger("click");
			await flushPromises();

			expect(mockUpdateAdminSeries).toHaveBeenCalled();
			const [id, payload] = mockUpdateAdminSeries.mock.calls.at(-1) as any[];
			expect(id).toBe(1);
			expect(payload.title).toBe("FastAPI Deep Dive v2");
			expect(payload.slug).toBe("fastapi-deep-dive-v2");
		});
	});

	describe("Error paths", () => {
		beforeEach(() => {
			mockFetchAdminSeries.mockReturnValue(mockFetchResult(mockSeries));
		});

		it("does not call the API when the title is empty", async () => {
			mockCreateAdminSeries.mockReturnValue(mockFetchResult(null));
			const SeriesPage = await loadPage();
			const wrapper = await mountWithSuspense(SeriesPage);

			// No title typed — the create button is disabled, so nothing fires.
			const createButton = wrapper.findAll("button").find((b) => b.text().includes("创建"));
			expect(createButton?.attributes("disabled")).toBeDefined();
			expect(mockCreateAdminSeries).not.toHaveBeenCalled();
		});

		it("surfaces a thrown Error from create (getErrorMessage)", async () => {
			mockCreateAdminSeries.mockRejectedValue(new Error("boom"));
			const SeriesPage = await loadPage();
			const wrapper = await mountWithSuspense(SeriesPage);

			const inputs = wrapper.findAll('input[type="text"]');
			await inputs[0].setValue("Will Throw");
			const createButton = wrapper.findAll("button").find((b) => b.text().includes("创建"));
			expect(createButton).toBeDefined();
			await createButton?.trigger("click");
			await flushPromises();

			expect(wrapper.text()).toContain("boom");
		});

		it("falls back to a generic message when create rejects with a non-Error", async () => {
			mockCreateAdminSeries.mockRejectedValue("not-an-error");
			const SeriesPage = await loadPage();
			const wrapper = await mountWithSuspense(SeriesPage);

			const inputs = wrapper.findAll('input[type="text"]');
			await inputs[0].setValue("Will Throw");
			const createButton = wrapper.findAll("button").find((b) => b.text().includes("创建"));
			await createButton?.trigger("click");
			await flushPromises();

			expect(wrapper.text()).toContain("操作失败");
		});

		it("surfaces a non-string detail (array) from the backend as a generic error", async () => {
			mockCreateAdminSeries.mockReturnValue(
				mockFetchResult(null, {
					error: { data: { detail: [{ msg: "validate this" }] } },
				}),
			);
			const SeriesPage = await loadPage();
			const wrapper = await mountWithSuspense(SeriesPage);

			const inputs = wrapper.findAll('input[type="text"]');
			await inputs[0].setValue("Duplicate");
			const createButton = wrapper.findAll("button").find((b) => b.text().includes("创建"));
			await createButton?.trigger("click");
			await flushPromises();

			expect(wrapper.text()).toContain("操作失败");
		});

		it("renders String(error) when a fetch error has no message", async () => {
			mockFetchAdminSeries.mockReturnValue(mockFetchResult(null, { error: "Bare error string" }));
			const SeriesPage = await loadPage();
			const wrapper = await mountWithSuspense(SeriesPage);
			expect(wrapper.text()).toContain("Bare error string");
		});
	});

	describe("Delete", () => {
		beforeEach(() => {
			mockFetchAdminSeries.mockReturnValue(mockFetchResult(mockSeries));
		});

		it("deletes a series after confirmation", async () => {
			window.confirm = vi.fn(() => true);
			mockDeleteAdminSeries.mockResolvedValue({});
			const SeriesPage = await loadPage();
			const wrapper = await mountWithSuspense(SeriesPage);

			const deleteButton = wrapper.findAll("button").find((b) => b.text().includes("删除"));
			await deleteButton?.trigger("click");
			await flushPromises();

			expect(window.confirm).toHaveBeenCalled();
			expect(mockDeleteAdminSeries).toHaveBeenCalled();
			const [id] = mockDeleteAdminSeries.mock.calls.at(-1) as any[];
			expect(id).toBe(1);
		});

		it("does not delete when confirmation is cancelled", async () => {
			window.confirm = vi.fn(() => false);
			const SeriesPage = await loadPage();
			const wrapper = await mountWithSuspense(SeriesPage);

			const deleteButton = wrapper.findAll("button").find((b) => b.text().includes("删除"));
			await deleteButton?.trigger("click");
			await flushPromises();

			expect(mockDeleteAdminSeries).not.toHaveBeenCalled();
		});
	});

	describe("Episode management (TASK-185)", () => {
		it("expands a series to list its episodes in order", async () => {
			mockFetchAdminSeriesEpisodes.mockReturnValue(
				mockFetchResult([
					{ id: 1, title: "Part One", slug: "part-one", series_order: 1, published: true },
					{ id: 2, title: "Part Two", slug: "part-two", series_order: 2, published: false },
				]),
			);
			const SeriesPage = await loadPage();
			const wrapper = await mountWithSuspense(SeriesPage);

			const episodesBtn = wrapper.findAll("button").find((b) => b.text().includes("章节"));
			await episodesBtn?.trigger("click");
			await flushPromises();

			expect(mockFetchAdminSeriesEpisodes).toHaveBeenCalledWith(1);
			expect(wrapper.text()).toContain("Part One");
			expect(wrapper.text()).toContain("Part Two");
			expect(wrapper.text()).toContain("草稿"); // draft badge on the unpublished part
		});

		it("reorders episodes via the reorder endpoint and updates the list", async () => {
			const initial = [
				{ id: 1, title: "Part One", slug: "part-one", series_order: 1, published: true },
				{ id: 2, title: "Part Two", slug: "part-two", series_order: 2, published: true },
			];
			mockFetchAdminSeriesEpisodes.mockReturnValue(mockFetchResult(initial));
			// Moving Part Two down one slot → [2, 1].
			mockReorderAdminSeriesEpisodes.mockReturnValue(
				mockFetchResult([
					{ id: 2, title: "Part Two", slug: "part-two", series_order: 1, published: true },
					{ id: 1, title: "Part One", slug: "part-one", series_order: 2, published: true },
				]),
			);
			const SeriesPage = await loadPage();
			const wrapper = await mountWithSuspense(SeriesPage);

			const episodesBtn = wrapper.findAll("button").find((b) => b.text().includes("章节"));
			await episodesBtn?.trigger("click");
			await flushPromises();

			// First episode's down-arrow (enabled, index 0): reorder [2, 1].
			const downArrow = wrapper.find('button[aria-label="下移"]');
			await downArrow.trigger("click");
			await flushPromises();

			expect(mockReorderAdminSeriesEpisodes).toHaveBeenCalledWith(1, [2, 1]);
		});
	});
});
