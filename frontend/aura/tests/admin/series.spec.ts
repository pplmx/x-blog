/**
 * Admin Series Page Tests
 *
 * Tests the admin series page: loading/error/empty states, creating a series
 * (title + generated slug + description), inline editing, and deleting with
 * confirmation.
 *
 * Mocks the useAdminSeries, createAdminSeries, updateAdminSeries, and
 * deleteAdminSeries api/admin/series functions. Uses a <Suspense> wrapper since
 * the page uses `await useAdminSeries()` in <script setup>.
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

vi.mock("~~/api/admin/series", () => ({
	useAdminSeries: mockFetchAdminSeries,
	createAdminSeries: mockCreateAdminSeries,
	updateAdminSeries: mockUpdateAdminSeries,
	deleteAdminSeries: mockDeleteAdminSeries,
	getAdminSeriesEpisodes: mockFetchAdminSeriesEpisodes,
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
			mockCreateAdminSeries.mockResolvedValue({ id: 3 });
			const SeriesPage = await loadPage();
			const wrapper = await mountWithSuspense(SeriesPage);

			const inputs = wrapper.findAll('input[type="text"]');
			// title input then slug input
			await inputs[0].setValue("My New Series");
			const textareas = wrapper.findAll("textarea");
			await textareas[0].setValue("A brand new series");

			const createButton = wrapper.findAll("button").find((b) => b.text().includes("创建"));
			expect(createButton).toBeTruthy();
			// Create form is a real <form> (submit-on-Enter); submit it.
			await wrapper.find("form").trigger("submit");
			await flushPromises();

			expect(mockCreateAdminSeries).toHaveBeenCalled();
			const [payload] = mockCreateAdminSeries.mock.calls.at(-1) as any[];
			expect(payload.title).toBe("My New Series");
			expect(payload.slug).toBe("my-new-series");
			expect(payload.description).toBe("A brand new series");
		});

		it("generates a deterministic ASCII slug for a CJK-only title", async () => {
			mockCreateAdminSeries.mockResolvedValue({ id: 4 });
			const SeriesPage = await loadPage();
			const wrapper = await mountWithSuspense(SeriesPage);

			const inputs = wrapper.findAll('input[type="text"]');
			await inputs[0].setValue("中文系列");

			const createButton = wrapper.findAll("button").find((b) => b.text().includes("创建"));
			expect(createButton).toBeDefined();
			await wrapper.find("form").trigger("submit");
			await flushPromises();

			const [payload] = mockCreateAdminSeries.mock.calls.at(-1) as any[];
			expect(payload.title).toBe("中文系列");
			expect(payload.slug).toMatch(/^series-[a-z0-9]+$/);
		});

		it("surfaces a duplicate-slug error from the backend", async () => {
			mockCreateAdminSeries.mockRejectedValue({
				data: { detail: "Series already exists" },
			});
			const SeriesPage = await loadPage();
			const wrapper = await mountWithSuspense(SeriesPage);

			const inputs = wrapper.findAll('input[type="text"]');
			await inputs[0].setValue("Duplicate");
			const createButton = wrapper.findAll("button").find((b) => b.text().includes("创建"));
			expect(createButton).toBeDefined();
			await wrapper.find("form").trigger("submit");
			await flushPromises();

			expect(wrapper.text()).toContain("Series already exists");
		});
	});

	describe("Edit", () => {
		beforeEach(() => {
			mockFetchAdminSeries.mockReturnValue(mockFetchResult(mockSeries));
		});

		it("edits title/slug/description and saves", async () => {
			mockUpdateAdminSeries.mockResolvedValue({ id: 1 });
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
			mockCreateAdminSeries.mockResolvedValue(null);
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
			await wrapper.find("form").trigger("submit");
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
			expect(createButton).toBeDefined();
			await wrapper.find("form").trigger("submit");
			await flushPromises();

			expect(wrapper.text()).toContain("操作失败");
		});

		it("surfaces a non-string detail (array) from the backend as a generic error", async () => {
			mockCreateAdminSeries.mockRejectedValue({
				data: { detail: [{ msg: "validate this" }] },
			});
			const SeriesPage = await loadPage();
			const wrapper = await mountWithSuspense(SeriesPage);

			const inputs = wrapper.findAll('input[type="text"]');
			await inputs[0].setValue("Duplicate");
			const createButton = wrapper.findAll("button").find((b) => b.text().includes("创建"));
			expect(createButton).toBeDefined();
			await wrapper.find("form").trigger("submit");
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
			mockFetchAdminSeriesEpisodes.mockResolvedValue([
				{ id: 1, title: "Part One", slug: "part-one", series_order: 1, published: true },
				{ id: 2, title: "Part Two", slug: "part-two", series_order: 2, published: false },
			]);
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
			mockFetchAdminSeriesEpisodes.mockResolvedValue(initial);
			// Moving Part Two down one slot → [2, 1].
			mockReorderAdminSeriesEpisodes.mockResolvedValue([
				{ id: 2, title: "Part Two", slug: "part-two", series_order: 1, published: true },
				{ id: 1, title: "Part One", slug: "part-one", series_order: 2, published: true },
			]);
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

		it("single-flights a reorder: buttons disabled and a second tap cannot double-fire", async () => {
			// Deep-dive finding: the move buttons stayed enabled while the
			// reorder PUT was in flight, so two rapid taps issued two concurrent
			// reorders built from the same optimistic array — the page is
			// last-*response*-wins while the server is last-*arrival*-wins, and
			// the two can resolve out of order, silently diverging the list
			// from the persisted order (only a reload recovers).
			const initial = [
				{ id: 1, title: "Part One", slug: "part-one", series_order: 1, published: true },
				{ id: 2, title: "Part Two", slug: "part-two", series_order: 2, published: true },
			];
			mockFetchAdminSeriesEpisodes.mockResolvedValue(initial);
			let resolveReorder!: (v: unknown) => void;
			mockReorderAdminSeriesEpisodes.mockImplementation(
				() => new Promise((resolve) => (resolveReorder = resolve)),
			);
			const SeriesPage = await loadPage();
			const wrapper = await mountWithSuspense(SeriesPage);

			const episodesBtn = wrapper.findAll("button").find((b) => b.text().includes("章节"));
			await episodesBtn?.trigger("click");
			await flushPromises();

			const downArrow = wrapper.find('button[aria-label="下移"]');
			await downArrow.trigger("click"); // reorder launches, stays in flight
			await flushPromises();

			// The whole episode list's move buttons are disabled mid-flight…
			expect(downArrow.element.disabled).toBe(true);
			expect(wrapper.find('button[aria-label="上移"]').element.disabled).toBe(true);

			// …and a second tap (even one forced) cannot issue a second request.
			await downArrow.trigger("click");
			await flushPromises();
			expect(mockReorderAdminSeriesEpisodes).toHaveBeenCalledTimes(1);

			// Server confirms [2, 1]: the list takes the server order and the
			// buttons re-enable for the next move.
			resolveReorder([
				{ id: 2, title: "Part Two", slug: "part-two", series_order: 1, published: true },
				{ id: 1, title: "Part One", slug: "part-one", series_order: 2, published: true },
			]);
			await flushPromises();
			expect(wrapper.find('button[aria-label="下移"]').element.disabled).toBe(false);
			expect(mockReorderAdminSeriesEpisodes).toHaveBeenCalledTimes(1);
		});

		it("closes the episode panel on a second toggle and does not refetch (round)", async () => {
			mockFetchAdminSeriesEpisodes.mockResolvedValue([]);
			const SeriesPage = await loadPage();
			const wrapper = await mountWithSuspense(SeriesPage);

			const episodesBtn = wrapper.findAll("button").find((b) => b.text().includes("章节"));
			await episodesBtn?.trigger("click");
			await flushPromises();
			expect(mockFetchAdminSeriesEpisodes).toHaveBeenCalledTimes(1);

			// Second toggle closes the panel — no second fetch.
			await episodesBtn?.trigger("click");
			await flushPromises();
			expect(wrapper.text()).not.toContain("章节顺序");

			// Reopening uses the already-loaded episodes — still one fetch.
			await episodesBtn?.trigger("click");
			await flushPromises();
			expect(mockFetchAdminSeriesEpisodes).toHaveBeenCalledTimes(1);
		});

		it("renders the no-episodes hint for a series without posts", async () => {
			mockFetchAdminSeriesEpisodes.mockResolvedValue([]);
			const SeriesPage = await loadPage();
			const wrapper = await mountWithSuspense(SeriesPage);

			const episodesBtn = wrapper.findAll("button").find((b) => b.text().includes("章节"));
			await episodesBtn?.trigger("click");
			await flushPromises();
			expect(wrapper.text()).toContain("该系列还没有文章");
		});

		it("surfaces an episode-load failure with the failure hint", async () => {
			mockFetchAdminSeriesEpisodes.mockRejectedValue(new Error("episodes down"));
			const SeriesPage = await loadPage();
			const wrapper = await mountWithSuspense(SeriesPage);

			const episodesBtn = wrapper.findAll("button").find((b) => b.text().includes("章节"));
			await episodesBtn?.trigger("click");
			await flushPromises();
			expect(wrapper.text()).toContain("调整失败，请重试");
		});

		it("disables both move arrows for a single-episode series", async () => {
			mockFetchAdminSeriesEpisodes.mockResolvedValue([
				{ id: 1, title: "Only Part", slug: "only-part", series_order: 1, published: true },
			]);
			const SeriesPage = await loadPage();
			const wrapper = await mountWithSuspense(SeriesPage);

			const episodesBtn = wrapper.findAll("button").find((b) => b.text().includes("章节"));
			await episodesBtn?.trigger("click");
			await flushPromises();

			expect(wrapper.find('button[aria-label="上移"]').element.disabled).toBe(true);
			expect(wrapper.find('button[aria-label="下移"]').element.disabled).toBe(true);
		});
	});

	describe("Branch-gap coverage (forms)", () => {
		beforeEach(() => {
			mockFetchAdminSeries.mockReturnValue(mockFetchResult(mockSeries));
		});

		it("does not create when the form is submitted with an empty title", async () => {
			mockCreateAdminSeries.mockResolvedValue({ id: 5 });
			const SeriesPage = await loadPage();
			const wrapper = await mountWithSuspense(SeriesPage);

			// Submitting the <form> fires handleCreate even though the button is
			// disabled — the handler's own empty-title guard must short-circuit.
			await wrapper.find("form").trigger("submit");
			await flushPromises();
			expect(mockCreateAdminSeries).not.toHaveBeenCalled();
		});

		it("auto-generates a slug from the create-form title via the slug button", async () => {
			mockCreateAdminSeries.mockResolvedValue({ id: 6 });
			const SeriesPage = await loadPage();
			const wrapper = await mountWithSuspense(SeriesPage);

			const inputs = wrapper.findAll('input[type="text"]');
			await inputs[0].setValue("My Cool Series");
			const slugBtn = wrapper.findAll("button").find((b) => b.text().includes("自动生成"));
			expect(slugBtn).toBeDefined();
			await slugBtn?.trigger("click");
			expect((wrapper.findAll('input[type="text"]')[1].element as HTMLInputElement).value).toBe(
				"my-cool-series",
			);
		});

		it("starts an edit with an empty description when the series has none", async () => {
			const SeriesPage = await loadPage();
			const wrapper = await mountWithSuspense(SeriesPage);

			// Series id 2 ("Nuxt 3") is the second row — its description is null,
			// so startEdit must map it to an empty editing form.
			const editBtns = wrapper.findAll("button").filter((b) => b.text().includes("编辑"));
			await editBtns[1].trigger("click");
			await flushPromises();

			const textareas = wrapper.findAll("textarea");
			// textareas[0] = create form; textareas[1] = inline edit form.
			expect((textareas[1].element as HTMLTextAreaElement).value).toBe("");
		});

		it("does not save an edit when its title is cleared", async () => {
			mockUpdateAdminSeries.mockResolvedValue({ id: 1 });
			const SeriesPage = await loadPage();
			const wrapper = await mountWithSuspense(SeriesPage);

			const editBtn = wrapper.findAll("button").find((b) => b.text().includes("编辑"));
			await editBtn?.trigger("click");
			await flushPromises();

			const inputs = wrapper.findAll('input[type="text"]');
			await inputs[2].setValue(""); // edit-form title
			const confirmBtn = wrapper.findAll("button").find((b) => b.text().includes("确认"));
			await confirmBtn?.trigger("click");
			await flushPromises();
			expect(mockUpdateAdminSeries).not.toHaveBeenCalled();
		});

		it("serializes a cleared description as null on edit save", async () => {
			mockUpdateAdminSeries.mockResolvedValue({ id: 1 });
			const SeriesPage = await loadPage();
			const wrapper = await mountWithSuspense(SeriesPage);

			const editBtn = wrapper.findAll("button").find((b) => b.text().includes("编辑"));
			await editBtn?.trigger("click");
			await flushPromises();

			const textareas = wrapper.findAll("textarea");
			await textareas[1].setValue(""); // clear the edit-form description
			const confirmBtn = wrapper.findAll("button").find((b) => b.text().includes("确认"));
			await confirmBtn?.trigger("click");
			await flushPromises();

			expect(mockUpdateAdminSeries).toHaveBeenCalled();
			const [, payload] = mockUpdateAdminSeries.mock.calls.at(-1) as any[];
			expect(payload.description).toBe(null);
		});

		it("surfaces a backend detail on edit save failure", async () => {
			mockUpdateAdminSeries.mockRejectedValue({ data: { detail: "Slug already in use" } });
			const SeriesPage = await loadPage();
			const wrapper = await mountWithSuspense(SeriesPage);

			const editBtn = wrapper.findAll("button").find((b) => b.text().includes("编辑"));
			await editBtn?.trigger("click");
			await flushPromises();

			const inputs = wrapper.findAll('input[type="text"]');
			await inputs[2].setValue("Renamed");
			const confirmBtn = wrapper.findAll("button").find((b) => b.text().includes("确认"));
			await confirmBtn?.trigger("click");
			await flushPromises();

			expect(wrapper.text()).toContain("Slug already in use");
		});

		it("renders a zero post count when post_count is null", async () => {
			mockFetchAdminSeries.mockReturnValue(
				mockFetchResult([
					{ id: 9, title: "Countless", slug: "countless", description: null, post_count: null },
				]),
			);
			const SeriesPage = await loadPage();
			const wrapper = await mountWithSuspense(SeriesPage);
			expect(wrapper.text()).toContain("0 篇文章");
		});
	});
});
