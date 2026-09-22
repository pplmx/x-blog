/**
 * Admin Pages Page Tests (round 347)
 *
 * The static-pages CMS manager: loading/error/empty states, creating a page
 * (title + auto slug + markdown content + publish toggle), inline editing,
 * publish/unpublish toggle, and deleting with confirmation.
 *
 * Mocks the api/admin/pages functions. Uses a <Suspense> wrapper since the
 * page uses `await useAdminPages()` in <script setup>.
 */

import { flushPromises } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import { mountWithSuspense } from "./helpers.ts";

const { mockFetchAdminPages, mockCreateAdminPage, mockUpdateAdminPage, mockDeleteAdminPage } =
	vi.hoisted(() => ({
		mockFetchAdminPages: vi.fn(),
		mockCreateAdminPage: vi.fn(),
		mockUpdateAdminPage: vi.fn(),
		mockDeleteAdminPage: vi.fn(),
	}));

vi.mock("~~/api/admin/pages", () => ({
	useAdminPages: mockFetchAdminPages,
	createAdminPage: mockCreateAdminPage,
	updateAdminPage: mockUpdateAdminPage,
	deleteAdminPage: mockDeleteAdminPage,
}));

vi.stubGlobal("useRuntimeConfig", () => ({
	public: { apiUrl: "http://localhost:18888" },
}));
vi.stubGlobal("navigateTo", vi.fn());
vi.stubGlobal("useHead", vi.fn());
vi.stubGlobal("definePageMeta", vi.fn());

const originalConfirm = window.confirm;

const mockPages = [
	{
		id: 1,
		title: "Privacy Policy",
		slug: "privacy",
		published: true,
		content: "## Data",
		created_at: null,
		updated_at: null,
	},
	{
		id: 2,
		title: "WIP Contact",
		slug: "contact",
		published: false,
		content: "",
		created_at: null,
		updated_at: null,
	},
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
	const { default: PagesPage } = await import("@/pages/admin/pages.vue");
	return PagesPage;
}

describe("Admin Pages Page", () => {
	afterEach(() => {
		vi.restoreAllMocks();
		vi.clearAllMocks();
		window.confirm = originalConfirm;
	});

	describe("Loading state", () => {
		it("renders loading message when pages are pending", async () => {
			mockFetchAdminPages.mockReturnValue(mockFetchResult(null, { pending: true }));
			const Page = await loadPage();
			const wrapper = await mountWithSuspense(Page);
			expect(wrapper.text()).toContain("正在加载页面");
		});
	});

	describe("Error state", () => {
		it("renders the load-failed state instead of the empty state", async () => {
			// Stable state object so the page's `refresh` (reached via the retry
			// button) is addressable after the AsyncData-like destructure.
			const state = mockFetchResult(null, { error: { message: "Fetch error" } });
			mockFetchAdminPages.mockReturnValue(state);
			const Page = await loadPage();
			const wrapper = await mountWithSuspense(Page);
			expect(wrapper.text()).toContain("页面加载失败");
			expect(wrapper.text()).not.toContain("还没有页面");
			// A failed list must not be a dead end: the retry button re-runs the
			// fetch (sibling admin lists contract, round-417 polish).
			const retry = wrapper.findAll("button").find((b) => b.text().includes("重试"));
			expect(retry).toBeDefined();
			expect(state.refresh).not.toHaveBeenCalled();
			await retry?.trigger("click");
			await flushPromises();
			expect(state.refresh).toHaveBeenCalledTimes(1);
		});
	});

	describe("Empty state", () => {
		it("renders empty state when no pages exist", async () => {
			mockFetchAdminPages.mockReturnValue(mockFetchResult([]));
			const Page = await loadPage();
			const wrapper = await mountWithSuspense(Page);
			expect(wrapper.text()).toContain("还没有页面");
		});
	});

	describe("Populated state", () => {
		beforeEach(() => {
			mockFetchAdminPages.mockReturnValue(mockFetchResult(mockPages));
		});

		it("renders each page with title, slug and published/draft chip", async () => {
			const Page = await loadPage();
			const wrapper = await mountWithSuspense(Page);
			expect(wrapper.text()).toContain("Privacy Policy");
			expect(wrapper.text()).toContain("/pages/privacy");
			expect(wrapper.text()).toContain("已发布");
			expect(wrapper.text()).toContain("草稿");
		});

		it("links a published page to its public URL", async () => {
			const Page = await loadPage();
			const wrapper = await mountWithSuspense(Page);
			const link = wrapper.findAll("a").find((a) => a.attributes("href") === "/pages/privacy");
			expect(link?.exists()).toBe(true);
		});
	});

	describe("Create", () => {
		beforeEach(() => {
			mockFetchAdminPages.mockReturnValue(mockFetchResult(mockPages));
		});

		it("creates a page with title, generated slug, content and publish flag", async () => {
			mockCreateAdminPage.mockResolvedValue({ id: 3 });
			const Page = await loadPage();
			const wrapper = await mountWithSuspense(Page);

			const inputs = wrapper.findAll('input[type="text"]');
			await inputs[0].setValue("Terms of Service");
			const textareas = wrapper.findAll("textarea");
			await textareas[0].setValue("## Your rights");
			await wrapper.find("#page-publish").setValue(true);

			const createButton = wrapper.findAll("button").find((b) => b.text().includes("创建"));
			expect(createButton).toBeTruthy();
			// vue-test-utils does not fire the native submit action on a
			// submit-button click — trigger the form's submit handler directly
			// (same pattern as the series admin spec).
			await wrapper.find("form").trigger("submit");
			await flushPromises();

			expect(mockCreateAdminPage).toHaveBeenCalledWith({
				title: "Terms of Service",
				slug: "terms-of-service",
				content: "## Your rights",
				published: true,
			});
		});
	});

	describe("Edit", () => {
		beforeEach(() => {
			mockFetchAdminPages.mockReturnValue(mockFetchResult(mockPages));
		});

		it("edits a page's title/slug/content inline", async () => {
			mockUpdateAdminPage.mockResolvedValue({});
			const Page = await loadPage();
			const wrapper = await mountWithSuspense(Page);

			const editButton = wrapper.findAll("button").find((b) => b.text().includes("编辑"));
			expect(editButton).toBeTruthy();
			await editButton?.trigger("click");
			await flushPromises();

			const titleInput = wrapper.find("#edit-page-title-1");
			await titleInput.setValue("Privacy Policy v2");
			const saveButton = wrapper.findAll("button").find((b) => b.text().includes("保存"));
			await saveButton?.trigger("click");
			await flushPromises();

			expect(mockUpdateAdminPage).toHaveBeenCalled();
			const [, patch] = mockUpdateAdminPage.mock.calls[0];
			expect(patch.title).toBe("Privacy Policy v2");
		});

		it("unpublishes a page from the row toggle", async () => {
			mockUpdateAdminPage.mockResolvedValue({});
			const Page = await loadPage();
			const wrapper = await mountWithSuspense(Page);

			const unpublishButton = wrapper.findAll("button").find((b) => b.text().includes("下架"));
			expect(unpublishButton).toBeTruthy();
			await unpublishButton?.trigger("click");
			await flushPromises();

			expect(mockUpdateAdminPage).toHaveBeenCalledWith(1, { published: false });
		});
	});

	describe("Delete", () => {
		beforeEach(() => {
			mockFetchAdminPages.mockReturnValue(mockFetchResult(mockPages));
		});

		it("deletes a page after confirmation", async () => {
			mockDeleteAdminPage.mockResolvedValue(undefined);
			window.confirm = vi.fn(() => true);
			const Page = await loadPage();
			const wrapper = await mountWithSuspense(Page);

			const deleteButton = wrapper.findAll("button").find((b) => b.text().includes("删除"));
			expect(deleteButton).toBeTruthy();
			await deleteButton?.trigger("click");
			await flushPromises();

			expect(window.confirm).toHaveBeenCalled();
			expect(mockDeleteAdminPage).toHaveBeenCalledWith(1);
		});

		it("does not delete when confirmation is declined", async () => {
			mockDeleteAdminPage.mockResolvedValue(undefined);
			window.confirm = vi.fn(() => false);
			const Page = await loadPage();
			const wrapper = await mountWithSuspense(Page);

			const deleteButton = wrapper.findAll("button").find((b) => b.text().includes("删除"));
			await deleteButton?.trigger("click");
			await flushPromises();
			expect(mockDeleteAdminPage).not.toHaveBeenCalled();
		});

		it("disables the row publish toggle and delete button while an action is in flight", async () => {
			// A delete that never settles keeps isProcessing=true so we can observe
			// the :disabled binding; resolved at the end to avoid a leaked task.
			let resolveDelete!: () => void;
			mockDeleteAdminPage.mockReturnValue(
				new Promise<void>((r) => {
					resolveDelete = r;
				}),
			);
			window.confirm = vi.fn(() => true);
			const Page = await loadPage();
			const wrapper = await mountWithSuspense(Page);

			const deleteButton = wrapper.findAll("button").find((b) => b.text().includes("删除"));
			const unpublishButton = wrapper.findAll("button").find((b) => b.text().includes("下架"));
			expect(deleteButton?.attributes("disabled")).toBeUndefined();
			expect(unpublishButton?.attributes("disabled")).toBeUndefined();

			await deleteButton?.trigger("click");
			await flushPromises();

			// In-flight: both network row actions are disabled, so a second tap
			// can't issue a concurrent delete/toggle (deep-dive F3(b) round 395).
			expect(deleteButton?.attributes("disabled")).toBeDefined();
			const unpublishWhileBusy = wrapper.findAll("button").find((b) => b.text().includes("下架"));
			expect(unpublishWhileBusy?.attributes("disabled")).toBeDefined();

			resolveDelete();
			await flushPromises();
		});
	});
});
