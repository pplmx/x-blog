/**
 * Admin Categories Page Tests
 *
 * Tests the admin categories page: loading state, error state,
 * empty state, creating a category (with input validation),
 * editing a category (inline edit + save/cancel), and deleting
 * a category with confirmation.
 *
 * Mocks the fetchAdminCategories, createAdminCategory,
 * updateAdminCategory, and deleteAdminCategory composables.
 * Uses a <Suspense> wrapper since the page uses
 * `await fetchAdminCategories()` in <script setup>.
 */

import { flushPromises } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import { mountWithSuspense } from "./helpers.ts";

const {
	mockFetchAdminCategories,
	mockCreateAdminCategory,
	mockUpdateAdminCategory,
	mockDeleteAdminCategory,
} = vi.hoisted(() => ({
	mockFetchAdminCategories: vi.fn(),
	mockCreateAdminCategory: vi.fn(),
	mockUpdateAdminCategory: vi.fn(),
	mockDeleteAdminCategory: vi.fn(),
}));

vi.mock("~/composables/useApi", () => ({
	fetchAdminCategories: mockFetchAdminCategories,
	createAdminCategory: mockCreateAdminCategory,
	updateAdminCategory: mockUpdateAdminCategory,
	deleteAdminCategory: mockDeleteAdminCategory,
}));

vi.stubGlobal("useRuntimeConfig", () => ({
	public: { apiUrl: "http://localhost:18888" },
}));
vi.stubGlobal("navigateTo", vi.fn());
vi.stubGlobal("useHead", vi.fn());
vi.stubGlobal("definePageMeta", vi.fn());

const originalConfirm = window.confirm;

const mockCategories = [
	{ id: 1, name: "Technology" },
	{ id: 2, name: "Design" },
];

async function loadPage() {
	const { default: CategoriesPage } = await import("@/pages/admin/categories.vue");
	return CategoriesPage;
}

describe("Admin Categories Page", () => {
	afterEach(() => {
		vi.restoreAllMocks();
		vi.clearAllMocks();
		window.confirm = originalConfirm;
	});

	describe("Loading state", () => {
		it("renders loading message when categories are pending", async () => {
			mockFetchAdminCategories.mockReturnValue({
				data: ref(null),
				pending: ref(true),
				error: ref(null),
				refresh: vi.fn(),
			});

			const CategoriesPage = await loadPage();
			const wrapper = await mountWithSuspense(CategoriesPage);
			expect(wrapper.text()).toContain("加载中");
		});
	});

	describe("Error state", () => {
		it("renders error message when fetch fails", async () => {
			mockFetchAdminCategories.mockReturnValue({
				data: ref(null),
				pending: ref(false),
				error: ref({ message: "Fetch error" }),
				refresh: vi.fn(),
			});

			const CategoriesPage = await loadPage();
			const wrapper = await mountWithSuspense(CategoriesPage);
			expect(wrapper.text()).toContain("Fetch error");
		});
	});

	describe("Empty state", () => {
		it("renders empty state when no categories exist", async () => {
			mockFetchAdminCategories.mockReturnValue({
				data: ref([]),
				pending: ref(false),
				error: ref(null),
				refresh: vi.fn(),
			});

			const CategoriesPage = await loadPage();
			const wrapper = await mountWithSuspense(CategoriesPage);
			expect(wrapper.text()).toContain("还没有任何分类");
		});
	});

	describe("Populated state", () => {
		beforeEach(() => {
			mockFetchAdminCategories.mockReturnValue({
				data: ref(mockCategories),
				pending: ref(false),
				error: ref(null),
				refresh: vi.fn(),
			});
		});

		afterEach(() => {
			vi.clearAllMocks();
		});

		it("renders the page heading", async () => {
			const CategoriesPage = await loadPage();
			const wrapper = await mountWithSuspense(CategoriesPage);
			expect(wrapper.text()).toContain("分类管理");
		});

		it("renders the category count", async () => {
			const CategoriesPage = await loadPage();
			const wrapper = await mountWithSuspense(CategoriesPage);
			expect(wrapper.text()).toContain("2 个分类");
		});

		it("renders existing category names", async () => {
			const CategoriesPage = await loadPage();
			const wrapper = await mountWithSuspense(CategoriesPage);
			expect(wrapper.text()).toContain("Technology");
			expect(wrapper.text()).toContain("Design");
		});

		it("renders the create form input", async () => {
			const CategoriesPage = await loadPage();
			const wrapper = await mountWithSuspense(CategoriesPage);
			const input = wrapper.find('input[type="text"]');
			expect(input.exists()).toBe(true);
			expect(input.attributes("placeholder")).toContain("分类名称");
		});

		it("creates a category when name is entered and button is clicked", async () => {
			mockCreateAdminCategory.mockResolvedValue({});

			const CategoriesPage = await loadPage();
			const wrapper = await mountWithSuspense(CategoriesPage);

			const input = wrapper.find('input[type="text"]');
			await input.setValue("New Category");
			await wrapper.find("button").trigger("click");
			await flushPromises();

			expect(mockCreateAdminCategory).toHaveBeenCalledWith("New Category");
		});

		it("does NOT create a category when name is empty", async () => {
			const CategoriesPage = await loadPage();
			const wrapper = await mountWithSuspense(CategoriesPage);

			// Click the create button with empty input
			const createButton = wrapper.findAll("button").find((b) => b.text().includes("创建"));
			expect(createButton).toBeDefined();
			expect(createButton?.attributes("disabled")).toBeDefined();
		});

		it("clears the input after creating a category", async () => {
			mockCreateAdminCategory.mockResolvedValue({});

			const refreshMock = vi.fn();
			mockFetchAdminCategories.mockReturnValue({
				data: ref(mockCategories),
				pending: ref(false),
				error: ref(null),
				refresh: refreshMock,
			});

			const CategoriesPage = await loadPage();
			const wrapper = await mountWithSuspense(CategoriesPage);

			const input = wrapper.find('input[type="text"]');
			await input.setValue("New Category");
			await wrapper.find("button").trigger("click");
			await flushPromises();

			expect(input.element).toBeInstanceOf(HTMLInputElement);
			expect((input.element as HTMLInputElement).value).toBe("");
		});

		it("renders edit buttons for each category", async () => {
			const CategoriesPage = await loadPage();
			const wrapper = await mountWithSuspense(CategoriesPage);
			const editButtons = wrapper.findAll("button");
			const editBtn = editButtons.find((b) => b.text().includes("编辑"));
			expect(editBtn).toBeDefined();
		});

		it("enters edit mode when edit button is clicked", async () => {
			const CategoriesPage = await loadPage();
			const wrapper = await mountWithSuspense(CategoriesPage);

			const editButtons = wrapper.findAll("button");
			const editBtn = editButtons.find((b) => b.text().includes("编辑"));
			await editBtn?.trigger("click");
			await flushPromises();

			// Should show a save button (checkmark) in edit mode
			const saveButtons = wrapper.findAll("button");
			const saveBtn = saveButtons.find((b) => b.text().includes("确认"));
			expect(saveBtn).toBeDefined();
		});

		it("saves edited category name on confirm", async () => {
			mockUpdateAdminCategory.mockResolvedValue({});

			// Set up a working refresh mock
			const refreshMock = vi.fn();
			mockFetchAdminCategories.mockReturnValue({
				data: ref(mockCategories),
				pending: ref(false),
				error: ref(null),
				refresh: refreshMock,
			});

			const CategoriesPage = await loadPage();
			const wrapper = await mountWithSuspense(CategoriesPage);

			// Enter edit mode for Technology (id=1)
			const editButtons = wrapper.findAll("button");
			const editBtn = editButtons.find((b) => b.text().includes("编辑"));
			await editBtn?.trigger("click");
			await flushPromises();

			// Find the edit input (second input on the page, after the create form input)
			const allInputs = wrapper.findAll('input[type="text"]');
			const editInput = allInputs[1]; // First is create form, second is edit
			expect(editInput.exists()).toBe(true);
			await editInput.setValue("Updated Category");
			await flushPromises();

			// Click save
			const saveButton = wrapper.findAll("button").find((b) => b.text().includes("确认"));
			expect(saveButton).toBeDefined();
			await saveButton?.trigger("click");
			await flushPromises();

			expect(mockUpdateAdminCategory).toHaveBeenCalledWith(1, "Updated Category");
		});

		it("shows confirm button but no cancel button in edit mode", async () => {
			const CategoriesPage = await loadPage();
			const wrapper = await mountWithSuspense(CategoriesPage);

			// Enter edit mode
			const editButtons = wrapper.findAll("button");
			const editBtn = editButtons.find((b) => b.text().includes("编辑"));
			await editBtn?.trigger("click");
			await flushPromises();

			// Confirm button should be present
			const confirmButtons = wrapper.findAll("button");
			const confirmBtn = confirmButtons.find((b) => b.text().includes("确认"));
			expect(confirmBtn).toBeDefined();

			// No cancel button exists in the categories page edit mode
			const cancelButtons = wrapper.findAll("button");
			const cancelButton = cancelButtons.find((b) => b.text().includes("取消"));
			expect(cancelButton).toBeFalsy();
		});

		it("deletes a category with confirmation", async () => {
			window.confirm = vi.fn(() => true);
			mockDeleteAdminCategory.mockResolvedValue({});

			const CategoriesPage = await loadPage();
			const wrapper = await mountWithSuspense(CategoriesPage);

			const deleteButtons = wrapper.findAll("button");
			const deleteBtn = deleteButtons.find((b) => b.text().includes("删除"));
			expect(deleteBtn).toBeDefined();
			await deleteBtn?.trigger("click");
			await flushPromises();

			expect(window.confirm).toHaveBeenCalledWith("确定要删除这个分类吗？");
			expect(mockDeleteAdminCategory).toHaveBeenCalledWith(1);
		});

		it("does NOT delete a category when confirmation is cancelled", async () => {
			window.confirm = vi.fn(() => false);

			const CategoriesPage = await loadPage();
			const wrapper = await mountWithSuspense(CategoriesPage);

			const deleteButtons = wrapper.findAll("button");
			const deleteBtn = deleteButtons.find((b) => b.text().includes("删除"));
			await deleteBtn?.trigger("click");

			expect(mockDeleteAdminCategory).not.toHaveBeenCalled();
		});
	});
});
