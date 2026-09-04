/**
 * Admin Tags Page Tests
 *
 * Tests the admin tags page: loading state, error state,
 * empty state, creating a tag (with input validation),
 * editing a tag (inline edit + save/cancel), and deleting
 * a tag with confirmation.
 *
 * Mocks the useAdminTags, createAdminTag, updateAdminTag,
 * and deleteAdminTag api/admin/taxonomy functions. Uses a <Suspense> wrapper
 * since the page uses `await useAdminTags()` in <script setup>.
 */

import { flushPromises } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import { mountWithSuspense } from "./helpers.ts";

const { mockFetchAdminTags, mockCreateAdminTag, mockUpdateAdminTag, mockDeleteAdminTag } =
	vi.hoisted(() => ({
		mockFetchAdminTags: vi.fn(),
		mockCreateAdminTag: vi.fn(),
		mockUpdateAdminTag: vi.fn(),
		mockDeleteAdminTag: vi.fn(),
	}));

vi.mock("~~/api/admin/taxonomy", () => ({
	useAdminTags: mockFetchAdminTags,
	createAdminTag: mockCreateAdminTag,
	updateAdminTag: mockUpdateAdminTag,
	deleteAdminTag: mockDeleteAdminTag,
}));

vi.stubGlobal("useRuntimeConfig", () => ({
	public: { apiUrl: "http://localhost:18888" },
}));
vi.stubGlobal("navigateTo", vi.fn());
vi.stubGlobal("useHead", vi.fn());
vi.stubGlobal("definePageMeta", vi.fn());

const originalConfirm = window.confirm;

const mockTags = [
	{ id: 1, name: "javascript" },
	{ id: 2, name: "vue" },
];

async function loadPage() {
	const { default: TagsPage } = await import("@/pages/admin/tags.vue");
	return TagsPage;
}

/** Page text inputs EXCLUDING the taxonomy search box (added ISS-311 part 3):
 * the create form (index 0) and the per-chip inline edit input stay in the
 * same relative order the older tests were written against. */
function textInputs(wrapper: ReturnType<typeof mountWithSuspense>) {
	return wrapper
		.findAll('input[type="text"]')
		.filter((i) => i.attributes("data-testid") !== "taxonomy-search");
}

describe("Admin Tags Page", () => {
	afterEach(() => {
		vi.restoreAllMocks();
		vi.clearAllMocks();
		window.confirm = originalConfirm;
	});

	describe("Loading state", () => {
		it("renders loading message when tags are pending", async () => {
			mockFetchAdminTags.mockReturnValue({
				data: ref(null),
				pending: ref(true),
				error: ref(null),
				refresh: vi.fn(),
			});

			const TagsPage = await loadPage();
			const wrapper = await mountWithSuspense(TagsPage);
			expect(wrapper.text()).toContain("加载中");
		});
	});

	describe("Error state", () => {
		it("renders error message when fetch fails", async () => {
			mockFetchAdminTags.mockReturnValue({
				data: ref(null),
				pending: ref(false),
				error: ref({ message: "Fetch error" }),
				refresh: vi.fn(),
			});

			const TagsPage = await loadPage();
			const wrapper = await mountWithSuspense(TagsPage);
			expect(wrapper.text()).toContain("Fetch error");
		});
	});

	describe("Empty state", () => {
		it("renders empty state when no tags exist", async () => {
			mockFetchAdminTags.mockReturnValue({
				data: ref([]),
				pending: ref(false),
				error: ref(null),
				refresh: vi.fn(),
			});

			const TagsPage = await loadPage();
			const wrapper = await mountWithSuspense(TagsPage);
			expect(wrapper.text()).toContain("还没有任何标签");
		});
	});

	describe("Populated state", () => {
		beforeEach(() => {
			mockFetchAdminTags.mockReturnValue({
				data: ref(mockTags),
				pending: ref(false),
				error: ref(null),
				refresh: vi.fn(),
			});
		});

		afterEach(() => {
			vi.clearAllMocks();
		});

		it("renders the page heading", async () => {
			const TagsPage = await loadPage();
			const wrapper = await mountWithSuspense(TagsPage);
			expect(wrapper.text()).toContain("标签管理");
		});

		it("renders the tag count", async () => {
			const TagsPage = await loadPage();
			const wrapper = await mountWithSuspense(TagsPage);
			expect(wrapper.text()).toContain("2 个标签");
		});

		it("renders existing tag names", async () => {
			const TagsPage = await loadPage();
			const wrapper = await mountWithSuspense(TagsPage);
			expect(wrapper.text()).toContain("#javascript");
			expect(wrapper.text()).toContain("#vue");
		});

		it("renders the create form input", async () => {
			const TagsPage = await loadPage();
			const wrapper = await mountWithSuspense(TagsPage);
			const input = wrapper.find('input[type="text"]');
			expect(input.exists()).toBe(true);
			expect(input.attributes("placeholder")).toContain("标签名称");
		});

		it("creates a tag when name is entered and button is clicked", async () => {
			mockCreateAdminTag.mockResolvedValue({});

			const TagsPage = await loadPage();
			const wrapper = await mountWithSuspense(TagsPage);

			const input = wrapper.find('input[type="text"]');
			await input.setValue("New Tag");
			// Create form is a real <form> (submit-on-Enter); submit it.
			await wrapper.find("form").trigger("submit");
			await flushPromises();

			expect(mockCreateAdminTag).toHaveBeenCalledWith("New Tag");
		});

		it("does NOT create a tag when name is empty", async () => {
			const TagsPage = await loadPage();
			const wrapper = await mountWithSuspense(TagsPage);

			// The create button should be disabled when input is empty
			const createButton = wrapper.findAll("button").find((b) => b.text().includes("创建"));
			expect(createButton).toBeDefined();
			expect(createButton?.attributes("disabled")).toBeDefined();
		});

		it("clears the input after creating a tag", async () => {
			mockCreateAdminTag.mockResolvedValue({});

			const TagsPage = await loadPage();
			const wrapper = await mountWithSuspense(TagsPage);

			const input = wrapper.find('input[type="text"]');
			await input.setValue("New Tag");
			await wrapper.find("form").trigger("submit");
			await flushPromises();

			expect(input.element).toBeInstanceOf(HTMLInputElement);
			expect((input.element as HTMLInputElement).value).toBe("");
		});

		it("does not double-submit the create form while a create is in flight (deep-dive)", async () => {
			// The create button disables during processing, but Enter in the form
			// still fires submit — without a re-entry guard that races a second
			// create (duplicate tag / error) on fast repeat.
			let resolveCreate!: (v: unknown) => void;
			mockCreateAdminTag.mockImplementation(
				() =>
					new Promise((resolve) => {
						resolveCreate = resolve;
					}),
			);
			const TagsPage = await loadPage();
			const wrapper = await mountWithSuspense(TagsPage);

			const input = wrapper.find('input[type="text"]');
			await input.setValue("New Tag");
			await wrapper.find("form").trigger("submit");
			await flushPromises();
			expect(mockCreateAdminTag).toHaveBeenCalledTimes(1);

			// Second Enter while the first is still pending → guarded, no second call.
			await wrapper.find("form").trigger("submit");
			await flushPromises();
			expect(mockCreateAdminTag).toHaveBeenCalledTimes(1);

			resolveCreate({});
			await flushPromises();
			expect(mockCreateAdminTag).toHaveBeenCalledTimes(1);
		});

		it("renders edit buttons for each tag", async () => {
			const TagsPage = await loadPage();
			const wrapper = await mountWithSuspense(TagsPage);
			const editButtons = wrapper.findAll("button");
			const editBtn = editButtons.find((b) => {
				const svg = b.find('svg[data-icon="lucide:pencil"]');
				return svg.exists();
			});
			expect(editBtn).toBeDefined();
		});

		it("enters edit mode when edit button is clicked", async () => {
			const TagsPage = await loadPage();
			const wrapper = await mountWithSuspense(TagsPage);

			const editButtons = wrapper.findAll("button");
			const editBtn = editButtons.find((b) => {
				const svg = b.find('svg[data-icon="lucide:pencil"]');
				return svg.exists();
			});
			await editBtn?.trigger("click");
			await flushPromises();

			// Should show a save button (checkmark) in edit mode
			const saveButtons = wrapper.findAll("button");
			const saveBtn = saveButtons.find((b) => {
				const svg = b.find('svg[data-icon="lucide:check"]');
				return svg.exists();
			});
			expect(saveBtn).toBeDefined();
		});

		it("saves edited tag name on confirm", async () => {
			mockUpdateAdminTag.mockResolvedValue({});

			const TagsPage = await loadPage();
			const wrapper = await mountWithSuspense(TagsPage);

			// Enter edit mode for javascript (id=1)
			const editButtons = wrapper.findAll("button");
			const editBtn = editButtons.find((b) => {
				const svg = b.find('svg[data-icon="lucide:pencil"]');
				return svg.exists();
			});
			await editBtn?.trigger("click");
			await flushPromises();

			// Find the edit input (second input excluding the taxonomy search box)
			const allInputs = textInputs(wrapper);
			const editInput = allInputs[1]; // First is create form, second is edit
			expect(editInput.exists()).toBe(true);
			await editInput.setValue("Updated Tag");
			await flushPromises();

			// Click save
			const saveButtons = wrapper.findAll("button");
			const saveBtn = saveButtons.find((b) => {
				const svg = b.find('svg[data-icon="lucide:check"]');
				return svg.exists();
			});
			expect(saveBtn).toBeDefined();
			await saveBtn?.trigger("click");
			await flushPromises();

			expect(mockUpdateAdminTag).toHaveBeenCalledWith(1, "Updated Tag");
		});

		it("cancels edit and clears edit state", async () => {
			const TagsPage = await loadPage();
			const wrapper = await mountWithSuspense(TagsPage);

			// Enter edit mode - find the first pencil icon button
			const editButtons = wrapper.findAll("button");
			const editBtn = editButtons.find((b) => {
				const svg = b.find('svg[data-icon="lucide:pencil"]');
				return svg.exists();
			});
			await editBtn?.trigger("click");
			await flushPromises();

			// Cancel edit - find the X icon button
			const cancelButtons = wrapper.findAll("button");
			const cancelBtn = cancelButtons.find((b) => {
				const svg = b.find('svg[data-icon="lucide:x"]');
				return svg.exists();
			});
			expect(cancelBtn).toBeDefined();
			await cancelBtn?.trigger("click");
			await flushPromises();

			// Should no longer be in edit mode
			const saveButtons = wrapper.findAll("button");
			const saveBtn = saveButtons.find((b) => {
				const svg = b.find('svg[data-icon="lucide:check"]');
				return svg.exists();
			});
			expect(saveBtn).toBeFalsy();
		});

		it("Escape exits edit mode without committing", async () => {
			const TagsPage = await loadPage();
			const wrapper = await mountWithSuspense(TagsPage);

			const editBtn = wrapper
				.findAll("button")
				.find((b) => b.find('svg[data-icon="lucide:pencil"]').exists());
			await editBtn?.trigger("click");
			await flushPromises();

			const editInput = textInputs(wrapper)[1];
			await editInput.trigger("keydown", { key: "Escape" });
			await flushPromises();
			expect(mockUpdateAdminTag).not.toHaveBeenCalled();
			expect(wrapper.find('svg[data-icon="lucide:check"]').exists()).toBe(false);
		});

		it("filters the tag list with the taxonomy search box (ISS-311 part 3)", async () => {
			const TagsPage = await loadPage();
			const wrapper = await mountWithSuspense(TagsPage);
			expect(wrapper.text()).toContain("#javascript");
			expect(wrapper.text()).toContain("#vue");

			const search = wrapper.find('[data-testid="taxonomy-search"]');
			expect(search.exists()).toBe(true);
			await search.setValue("vue");
			await flushPromises();

			// Only the matching chip remains; the search-empty hint otherwise.
			expect(wrapper.text()).toContain("#vue");
			expect(wrapper.text()).not.toContain("#javascript");

			await search.setValue("zzz-none");
			await flushPromises();
			expect(wrapper.text()).toContain("没有匹配的标签");

			await search.setValue("");
			await flushPromises();
			expect(wrapper.text()).toContain("#javascript");
		});

		it("exposes accessible names on the icon-only action buttons", async () => {
			const TagsPage = await loadPage();
			const wrapper = await mountWithSuspense(TagsPage);

			const pencil = wrapper
				.findAll("button")
				.find((b) => b.find('svg[data-icon="lucide:pencil"]').exists());
			expect(pencil?.attributes("aria-label")).toBe("编辑");
			expect(pencil?.attributes("title")).toBe("编辑");

			const trash = wrapper
				.findAll("button")
				.find((b) => b.find('svg[data-icon="lucide:trash-2"]').exists());
			expect(trash?.attributes("aria-label")).toBe("删除");
			expect(trash?.attributes("title")).toBe("删除");
		});

		it("deletes a tag with confirmation", async () => {
			window.confirm = vi.fn(() => true);
			mockDeleteAdminTag.mockResolvedValue({});

			const TagsPage = await loadPage();
			const wrapper = await mountWithSuspense(TagsPage);

			const deleteButtons = wrapper.findAll("button");
			const deleteBtn = deleteButtons.find((b) => {
				const svg = b.find('svg[data-icon="lucide:trash-2"]');
				return svg.exists();
			});
			expect(deleteBtn).toBeDefined();
			await deleteBtn?.trigger("click");
			await flushPromises();

			expect(window.confirm).toHaveBeenCalledWith("确定要删除这个标签吗？");
			expect(mockDeleteAdminTag).toHaveBeenCalledWith(1);
		});

		it("does NOT delete a tag when confirmation is cancelled", async () => {
			window.confirm = vi.fn(() => false);

			const TagsPage = await loadPage();
			const wrapper = await mountWithSuspense(TagsPage);

			const deleteButtons = wrapper.findAll("button");
			const deleteBtn = deleteButtons.find((b) => {
				const svg = b.find('svg[data-icon="lucide:trash-2"]');
				return svg.exists();
			});
			await deleteBtn?.trigger("click");

			expect(mockDeleteAdminTag).not.toHaveBeenCalled();
		});
	});
});
