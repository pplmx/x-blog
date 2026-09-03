/**
 * Admin Categories Page Tests
 *
 * Tests the admin categories page: loading state, error state,
 * empty state, creating a category (with input validation),
 * editing a category (inline edit + save/cancel), and deleting
 * a category with confirmation.
 *
 * Mocks the useAdminCategories, createAdminCategory,
 * updateAdminCategory, and deleteAdminCategory api/admin/taxonomy functions.
 * Uses a <Suspense> wrapper since the page uses
 * `await useAdminCategories()` in <script setup>.
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

vi.mock("~~/api/admin/taxonomy", () => ({
	useAdminCategories: mockFetchAdminCategories,
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

/** Page text inputs EXCLUDING the taxonomy search box (added ISS-311 part 3):
 * the create form (index 0) and the per-row inline edit input stay in the
 * same relative order the older tests were written against. */
function textInputs(wrapper: ReturnType<typeof mountWithSuspense>) {
	return wrapper
		.findAll('input[type="text"]')
		.filter((i) => i.attributes("data-testid") !== "taxonomy-search");
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
			// Create form is a real <form> (submit-on-Enter); submit it.
			await wrapper.find("form").trigger("submit");
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
			await wrapper.find("form").trigger("submit");
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

			// Find the edit input (second input excluding the taxonomy search box)
			const allInputs = textInputs(wrapper);
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

		it("shows a cancel button in edit mode and it exits without committing (deep-dive)", async () => {
			const CategoriesPage = await loadPage();
			const wrapper = await mountWithSuspense(CategoriesPage);

			// Enter edit mode
			const editBtn = wrapper.findAll("button").find((b) => b.text().includes("编辑"));
			await editBtn?.trigger("click");
			await flushPromises();

			// Confirm row action (save) requires a spinner etc. — the point of
			// this test is the ESCAPE path: a mis-clicked Edit must not trap the
			// operator into confirming or deleting. Both confirm AND cancel are
			// present in edit mode.
			const buttons = wrapper.findAll("button");
			expect(buttons.find((b) => b.text().includes("确认"))).toBeDefined();
			const cancelButton = buttons.find((b) => b.text().includes("取消"));
			expect(cancelButton).toBeDefined();

			// Cancel exits edit mode and does NOT fire an update request.
			await cancelButton?.trigger("click");
			await flushPromises();
			expect(mockUpdateAdminCategory).not.toHaveBeenCalled();
			// The row is back to its static (non-editing) state.
			expect(textInputs(wrapper).length).toBe(1); // create-form only
		});

		it("Escape exits edit mode like the cancel button", async () => {
			const CategoriesPage = await loadPage();
			const wrapper = await mountWithSuspense(CategoriesPage);

			const editBtn = wrapper.findAll("button").find((b) => b.text().includes("编辑"));
			await editBtn?.trigger("click");
			await flushPromises();
			expect(textInputs(wrapper).length).toBe(2);

			const editInput = textInputs(wrapper)[1];
			await editInput.trigger("keydown", { key: "Escape" });
			await flushPromises();
			expect(mockUpdateAdminCategory).not.toHaveBeenCalled();
			expect(textInputs(wrapper).length).toBe(1);
		});

		it("filters the category list with the taxonomy search box (ISS-311 part 3)", async () => {
			const CategoriesPage = await loadPage();
			const wrapper = await mountWithSuspense(CategoriesPage);
			expect(wrapper.text()).toContain("Technology");
			expect(wrapper.text()).toContain("Design");

			const search = wrapper.find('[data-testid="taxonomy-search"]');
			expect(search.exists()).toBe(true);
			await search.setValue("tech");
			await flushPromises();

			// Only the matching name remains; the search-empty hint renders.
			expect(wrapper.text()).toContain("Technology");
			expect(wrapper.text()).not.toContain("Design");

			await search.setValue("zzz-none");
			await flushPromises();
			expect(wrapper.text()).toContain("没有匹配的分类");

			// Clearing restores the full list.
			await search.setValue("");
			await flushPromises();
			expect(wrapper.text()).toContain("Design");
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
