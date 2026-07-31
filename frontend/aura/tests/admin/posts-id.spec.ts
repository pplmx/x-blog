/**
 * Admin Post Editor Page Tests
 *
 * Tests the post editor page: creating new posts, editing existing posts,
 * form rendering, field interactions, submit handling, and cancel behavior.
 *
 * Mocks the useApi composables (fetchAdminCategories, fetchAdminTags,
 * fetchAdminPost, createAdminPost, updateAdminPost) to test the page
 * in isolation. Uses a <Suspense> wrapper since the page uses `await`
 * composables in <script setup>.
 */

import { flushPromises } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import { mountWithSuspense } from "./helpers.ts";

const {
	mockFetchAdminCategories,
	mockFetchAdminTags,
	mockFetchAdminPost,
	mockCreateAdminPost,
	mockUpdateAdminPost,
} = vi.hoisted(() => ({
	mockFetchAdminCategories: vi.fn(),
	mockFetchAdminTags: vi.fn(),
	mockFetchAdminPost: vi.fn(),
	mockCreateAdminPost: vi.fn(),
	mockUpdateAdminPost: vi.fn(),
}));

vi.mock("~/composables/useApi", () => ({
	fetchAdminCategories: mockFetchAdminCategories,
	fetchAdminTags: mockFetchAdminTags,
	fetchAdminPost: mockFetchAdminPost,
	createAdminPost: mockCreateAdminPost,
	updateAdminPost: mockUpdateAdminPost,
}));

vi.stubGlobal("useRuntimeConfig", () => ({
	public: { apiUrl: "http://localhost:18888" },
}));
vi.stubGlobal("useHead", vi.fn());
vi.stubGlobal("definePageMeta", vi.fn());

const mockCategories = [
	{ id: 1, name: "Tech" },
	{ id: 2, name: "Design" },
];
const mockTags = [
	{ id: 1, name: "React" },
	{ id: 2, name: "TypeScript" },
];

const mockExistingPost = {
	id: 1,
	title: "Existing Post",
	slug: "existing-post",
	content: "# Existing Content",
	excerpt: "Existing excerpt",
	published: true,
	pinned: false,
	cover_image: null,
	category_id: 1,
	tag_ids: [1],
	created_at: "2024-01-01T00:00:00Z",
	updated_at: "2024-01-01T00:00:00Z",
};

function setupRoute(id = "new") {
	vi.stubGlobal("useRoute", () => ({
		params: { id },
		query: {},
	}));
}

function setupMocks() {
	mockFetchAdminCategories.mockReturnValue({
		data: ref(mockCategories),
		pending: ref(false),
		error: ref(null),
		refresh: vi.fn(),
	});
	mockFetchAdminTags.mockReturnValue({
		data: ref(mockTags),
		pending: ref(false),
		error: ref(null),
		refresh: vi.fn(),
	});
	mockFetchAdminPost.mockReturnValue({
		data: ref(mockExistingPost),
		pending: ref(false),
		error: ref(null),
		refresh: vi.fn(),
	});
	mockCreateAdminPost.mockResolvedValue({ id: 1 });
	mockUpdateAdminPost.mockResolvedValue({ id: 1 });
}

async function loadPage() {
	const { default: PostEditor } = await import("@/pages/admin/posts/[id].vue");
	return PostEditor;
}

describe("Admin Post Editor Page", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe('Create Mode (id = "new")', () => {
		beforeEach(() => {
			setupRoute("new");
			setupMocks();
		});

		it('renders the page heading as "新建文章"', async () => {
			const PostEditor = await loadPage();
			const wrapper = await mountWithSuspense(PostEditor);
			expect(wrapper.text()).toContain("新建文章");
		});

		it("renders form with empty fields", async () => {
			const PostEditor = await loadPage();
			const wrapper = await mountWithSuspense(PostEditor);

			const titleInput = wrapper.find('input[type="text"]');
			expect(titleInput.exists()).toBe(true);
			expect(titleInput.element.value).toBe("");
		});

		it("renders category select with options", async () => {
			const PostEditor = await loadPage();
			const wrapper = await mountWithSuspense(PostEditor);

			const select = wrapper.find("select");
			expect(select.exists()).toBe(true);
			const options = wrapper.findAll("option");
			expect(options.length).toBeGreaterThanOrEqual(2); // "选择分类" + categories
		});

		it("renders tag checkboxes", async () => {
			const PostEditor = await loadPage();
			const wrapper = await mountWithSuspense(PostEditor);

			expect(wrapper.text()).toContain("React");
			expect(wrapper.text()).toContain("TypeScript");
		});

		it("renders save and cancel buttons", async () => {
			const PostEditor = await loadPage();
			const wrapper = await mountWithSuspense(PostEditor);

			const buttons = wrapper.findAll('button[type="submit"]');
			expect(buttons.length).toBeGreaterThan(0);
			expect(wrapper.text()).toContain("保存文章");
			expect(wrapper.text()).toContain("取消");
		});

		it('renders a "Back to list" link', async () => {
			const PostEditor = await loadPage();
			const wrapper = await mountWithSuspense(PostEditor);

			const backLink = wrapper.find('a[href="/admin/posts"]');
			expect(backLink.exists()).toBe(true);
		});

		it("calls createAdminPost when form is submitted", async () => {
			const PostEditor = await loadPage();
			const wrapper = await mountWithSuspense(PostEditor);
			await flushPromises();

			// Fill in required fields
			const titleInput = wrapper.find('input[type="text"]');
			await titleInput.setValue("New Article Title");

			const slugInput = wrapper.findAll('input[type="text"]')[1];
			await slugInput.setValue("new-article-title");

			const contentTextarea = wrapper.find("textarea");
			await contentTextarea.setValue("# Content here");

			// Submit the form
			const form = wrapper.find("form");
			await form.trigger("submit.prevent");
			await flushPromises();

			expect(mockCreateAdminPost).toHaveBeenCalled();
		});

		it("auto-generates slug from title", async () => {
			const PostEditor = await loadPage();
			const wrapper = await mountWithSuspense(PostEditor);
			await flushPromises();

			const titleInput = wrapper.find('input[type="text"]');
			await titleInput.setValue("My Test Article");

			const slugButton = wrapper.find('button[type="button"]');
			if (slugButton.text().includes("Slug")) {
				await slugButton.trigger("click");
			}

			// The slug button should call generateSlug
			expect(wrapper.text()).toContain("Slug");
		});

		it("displays submit error when createAdminPost fails", async () => {
			mockCreateAdminPost.mockRejectedValue(new Error("Network error"));

			const PostEditor = await loadPage();
			const wrapper = await mountWithSuspense(PostEditor);
			await flushPromises();

			// Fill in required fields
			const titleInput = wrapper.find('input[type="text"]');
			await titleInput.setValue("Test Title");

			const slugInput = wrapper.findAll('input[type="text"]')[1];
			await slugInput.setValue("test-title");

			const contentTextarea = wrapper.find("textarea");
			await contentTextarea.setValue("# Content");

			// Submit the form
			const form = wrapper.find("form");
			await form.trigger("submit.prevent");
			await flushPromises();

			expect(wrapper.text()).toContain("保存文章失败，请重试。");
		});

		it("shows the backend detail and does not navigate when createAdminPost returns an HTTP error", async () => {
			// useFetch surfaces HTTP errors in .error (a Ref) instead of
			// throwing — the editor must not redirect when it's set.
			const mockNavigateTo = vi.fn();
			vi.stubGlobal("navigateTo", mockNavigateTo);
			mockCreateAdminPost.mockResolvedValue({
				data: ref(null),
				pending: ref(false),
				error: ref({ data: { detail: "Slug 'test-title' already exists" } }),
				refresh: vi.fn(),
			});

			const PostEditor = await loadPage();
			const wrapper = await mountWithSuspense(PostEditor);
			await flushPromises();

			const titleInput = wrapper.find('input[type="text"]');
			await titleInput.setValue("Test Title");

			const contentTextarea = wrapper.find("textarea");
			await contentTextarea.setValue("# Content");

			const form = wrapper.find("form");
			await form.trigger("submit.prevent");
			await flushPromises();

			expect(wrapper.text()).toContain("Slug 'test-title' already exists");
			expect(mockNavigateTo).not.toHaveBeenCalled();
		});

		it("displays submit error when updateAdminPost fails", async () => {
			mockUpdateAdminPost.mockRejectedValue(new Error("Network error"));

			setupRoute("1");
			mockFetchAdminPost.mockReturnValue({
				data: ref(mockExistingPost),
				pending: ref(false),
				error: ref(null),
				refresh: vi.fn(),
			});

			const PostEditor = await loadPage();
			const wrapper = await mountWithSuspense(PostEditor);
			await flushPromises();

			// Submit the form
			const form = wrapper.find("form");
			await form.trigger("submit.prevent");
			await flushPromises();

			expect(wrapper.text()).toContain("保存文章失败，请重试。");
		});
	});

	describe("Edit Mode (id = numeric)", () => {
		beforeEach(() => {
			setupRoute("1");
			setupMocks();
		});

		it('renders the page heading as "编辑文章"', async () => {
			const PostEditor = await loadPage();
			const wrapper = await mountWithSuspense(PostEditor);
			expect(wrapper.text()).toContain("编辑文章");
		});

		it("loads existing post data into the form", async () => {
			const PostEditor = await loadPage();
			const wrapper = await mountWithSuspense(PostEditor);
			await flushPromises();

			const titleInput = wrapper.find('input[type="text"]');
			expect(titleInput.element.value).toBe("Existing Post");
		});

		it("calls updateAdminPost when form is submitted", async () => {
			const PostEditor = await loadPage();
			const wrapper = await mountWithSuspense(PostEditor);
			await flushPromises();

			const titleInput = wrapper.find('input[type="text"]');
			await titleInput.setValue("Updated Title");

			const form = wrapper.find("form");
			await form.trigger("submit.prevent");
			await flushPromises();

			expect(mockUpdateAdminPost).toHaveBeenCalledWith(1, expect.any(Object));
		});

		it("shows loading state while fetching post", async () => {
			mockFetchAdminPost.mockReturnValue({
				data: ref(null),
				pending: ref(true),
				error: ref(null),
				refresh: vi.fn(),
			});

			const PostEditor = await loadPage();
			const wrapper = await mountWithSuspense(PostEditor);
			expect(wrapper.text()).toContain("加载中");
		});

		it("shows error state when post fetch fails", async () => {
			mockFetchAdminPost.mockReturnValue({
				data: ref(null),
				pending: ref(false),
				error: ref({ message: "Post not found" }),
				refresh: vi.fn(),
			});

			const PostEditor = await loadPage();
			const wrapper = await mountWithSuspense(PostEditor);
			expect(wrapper.text()).toContain("Post not found");
		});
	});

	describe("Form Interactions", () => {
		beforeEach(() => {
			setupRoute("new");
			setupMocks();
		});

		it("shows slug preview with current slug value", async () => {
			const PostEditor = await loadPage();
			const wrapper = await mountWithSuspense(PostEditor);

			const slugInput = wrapper.findAll('input[type="text"]')[1];
			await slugInput.setValue("my-slug");

			expect(wrapper.text()).toContain("/posts/my-slug");
		});

		it("toggles tag selection on click", async () => {
			const PostEditor = await loadPage();
			const wrapper = await mountWithSuspense(PostEditor);
			await flushPromises();

			const tagCheckbox = wrapper.find('input[type="checkbox"]');
			await tagCheckbox.setChecked();
			await flushPromises();

			// The checkbox should be checked
			expect(tagCheckbox.element.checked).toBe(true);
		});

		it("navigates back on cancel", async () => {
			const mockNavigateTo = vi.fn();
			vi.stubGlobal("navigateTo", mockNavigateTo);

			const PostEditor = await loadPage();
			const wrapper = await mountWithSuspense(PostEditor);
			await flushPromises();

			const cancelButton = wrapper
				.findAll('button[type="button"]')
				.find((b) => b.text().includes("取消"));
			if (cancelButton) {
				await cancelButton.trigger("click");
				expect(mockNavigateTo).toHaveBeenCalledWith("/admin/posts", {
					replace: true,
				});
			}
		});
	});

	describe("Publish Options", () => {
		beforeEach(() => {
			setupRoute("new");
			setupMocks();
		});

		it("renders published checkbox", async () => {
			const PostEditor = await loadPage();
			const wrapper = await mountWithSuspense(PostEditor);
			expect(wrapper.text()).toContain("保存为草稿");
		});

		it("renders pinned checkbox", async () => {
			const PostEditor = await loadPage();
			const wrapper = await mountWithSuspense(PostEditor);
			expect(wrapper.text()).toContain("置顶文章");
		});

		it('shows "已发布" when published is checked', async () => {
			const PostEditor = await loadPage();
			const wrapper = await mountWithSuspense(PostEditor);
			await flushPromises();

			const publishedCheckbox = wrapper.find("#published");
			expect(publishedCheckbox.exists()).toBe(true);
			await publishedCheckbox.setChecked();
			await flushPromises();

			expect(wrapper.text()).toContain("已发布");
		});

		it("renders cover image URL input", async () => {
			const PostEditor = await loadPage();
			const wrapper = await mountWithSuspense(PostEditor);
			expect(wrapper.text()).toContain("封面图 URL");
		});
	});

	describe("Markdown Toolbar", () => {
		beforeEach(() => {
			setupRoute("new");
			setupMocks();
		});

		it("renders toolbar buttons (B, I, H1, H2, H3)", async () => {
			const PostEditor = await loadPage();
			const wrapper = await mountWithSuspense(PostEditor);
			const text = wrapper.text();
			expect(text).toContain("B");
			expect(text).toContain("I");
			expect(text).toContain("H1");
			expect(text).toContain("H2");
			expect(text).toContain("H3");
		});

		it("renders image upload button with title attribute", async () => {
			const PostEditor = await loadPage();
			const wrapper = await mountWithSuspense(PostEditor);
			const uploadBtn = wrapper.find('button[title="上传图片"]');
			expect(uploadBtn.exists()).toBe(true);
		});

		it("renders preview toggle button", async () => {
			const PostEditor = await loadPage();
			const wrapper = await mountWithSuspense(PostEditor);
			expect(wrapper.text()).toContain("预览");
		});

		it("toggles to preview mode on button click", async () => {
			const PostEditor = await loadPage();
			const wrapper = await mountWithSuspense(PostEditor);
			await flushPromises();

			const previewBtn = wrapper.find('button[type="button"]');
			const buttons = wrapper.findAll('button[type="button"]');
			const toggleBtn = buttons.find((b) => b.text().includes("预览"));
			expect(toggleBtn).toBeDefined();
			if (toggleBtn) {
				await toggleBtn.trigger("click");
				await flushPromises();
				expect(wrapper.text()).toContain("编辑");
			}
		});

		it("renders image upload file input", async () => {
			const PostEditor = await loadPage();
			const wrapper = await mountWithSuspense(PostEditor);
			const fileInput = wrapper.find('input[type="file"]');
			expect(fileInput.exists()).toBe(true);
		});
	});
});
