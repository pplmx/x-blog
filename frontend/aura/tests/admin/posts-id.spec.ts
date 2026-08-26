/**
 * Admin Post Editor Page Tests
 *
 * Tests the post editor page: creating new posts, editing existing posts,
 * form rendering, field interactions, submit handling, and cancel behavior.
 *
 * Mocks the api domain modules (posts, series, taxonomy, push) to test the
 * page in isolation. Uses a <Suspense> wrapper since the page uses `await`
 * composables in <script setup>.
 */

import { flushPromises } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import MarkdownContent from "~~/components/MarkdownContent.vue";
import { mountWithSuspense } from "./helpers.ts";

const {
	mockFetchAdminCategories,
	mockFetchAdminTags,
	mockFetchAdminPost,
	mockFetchAdminSeries,
	mockCreateAdminPost,
	mockUpdateAdminPost,
	mockNotifyPushSubscribers,
	mockFetchPostRevisions,
	mockRestorePostRevision,
} = vi.hoisted(() => ({
	mockFetchAdminCategories: vi.fn(),
	mockFetchAdminTags: vi.fn(),
	mockFetchAdminPost: vi.fn(),
	mockFetchAdminSeries: vi.fn(),
	mockCreateAdminPost: vi.fn(),
	mockUpdateAdminPost: vi.fn(),
	mockNotifyPushSubscribers: vi.fn(),
	mockFetchPostRevisions: vi.fn(),
	mockRestorePostRevision: vi.fn(),
}));

vi.mock("~~/api/admin/taxonomy", () => ({
	useAdminCategories: mockFetchAdminCategories,
	useAdminTags: mockFetchAdminTags,
}));
vi.mock("~~/api/admin/push", () => ({
	notifyPushSubscribers: mockNotifyPushSubscribers,
}));
vi.mock("~~/api/admin/posts", () => ({
	useAdminPost: mockFetchAdminPost,
	createAdminPost: mockCreateAdminPost,
	updateAdminPost: mockUpdateAdminPost,
	getPostRevisions: mockFetchPostRevisions,
	restorePostRevision: mockRestorePostRevision,
}));
vi.mock("~~/api/admin/series", () => ({
	useAdminSeries: mockFetchAdminSeries,
}));

vi.stubGlobal("useRuntimeConfig", () => ({
	public: { apiUrl: "http://localhost:18888" },
}));
vi.stubGlobal("useHead", vi.fn());
vi.stubGlobal("definePageMeta", vi.fn());

// Capture the route-leave guard callback so we can exercise it directly
// (the unit-test mount has no active router, so onBeforeRouteLeave wouldn't
// otherwise be invocable).
let capturedRouteLeave: (() => boolean) | null = null;
vi.mock("vue-router", () => ({
	onBeforeRouteLeave: (cb: () => boolean) => {
		capturedRouteLeave = cb;
	},
}));

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
	// series fields (DEC-056/TASK-123)
	series_id: 2,
	series_order: 3,
	series_title: "Deep Dive",
	series_slug: "deep-dive",
	created_at: "2024-01-01T00:00:00Z",
	updated_at: "2024-01-01T00:00:00Z",
};

const mockSeries = [
	{
		id: 1,
		title: "Nuxt 3 Essentials",
		slug: "nuxt-3-essentials",
		description: null,
		post_count: 1,
	},
	{ id: 2, title: "Deep Dive", slug: "deep-dive", description: null, post_count: 2 },
];

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
	mockFetchAdminSeries.mockReturnValue({
		data: ref(mockSeries),
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

		it("auto-generates a VALID ASCII slug for a Chinese-only title on submit (RIL TASK-106, ISS-086)", async () => {
			// ASCII-only \w strips CJK, so a Chinese-only title previously
			// produced "" or "-" -> backend 422 -> new post could not be saved.
			const PostEditor = await loadPage();
			const wrapper = await mountWithSuspense(PostEditor);
			await flushPromises();

			const titleInput = wrapper.find('input[type="text"]');
			await titleInput.setValue("我的第一篇中文博客");
			// Leave slug empty (new-post default); fill content to satisfy submit.
			const contentTextarea = wrapper.find("textarea");
			await contentTextarea.setValue("# 正文");

			const form = wrapper.find("form");
			await form.trigger("submit.prevent");
			await flushPromises();

			expect(mockCreateAdminPost).toHaveBeenCalled();
			const [payload] = mockCreateAdminPost.mock.calls[0] as any[];
			const slug = payload?.slug;
			// Must be non-empty and match the backend's slug pattern.
			expect(slug).toBeTruthy();
			expect(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)).toBe(true);
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
			// The post command rejects with a FetchError (422 detail arrives
			// in .data.detail) — the editor must surface it and not redirect.
			const mockNavigateTo = vi.fn();
			vi.stubGlobal("navigateTo", mockNavigateTo);
			mockCreateAdminPost.mockRejectedValue({
				data: { detail: "Slug 'test-title' already exists" },
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

		it("cover picker button opens the media library modal and fills the cover field", async () => {
			const PostEditor = await loadPage();
			// Stub the picker (it mounts an async media fetch we don't want to
			// exercise here) and capture the open prop + emitted select.
			const wrapper = await mountWithSuspense(PostEditor, {
				MediaPickerModal: {
					props: ["open"],
					template:
						'<div data-testid="media-picker" :data-open="String(open)"><button @click="$emit(\'select\', \'/static/uploads/2026/07/x.png\'); $emit(\'close\')">pick</button></div>',
				},
			});
			// The cover row has its own media-library button (distinct title from
			// the content toolbar's insert button, DEC-187).
			const coverPickers = wrapper.findAll('button[title="从媒体库选择封面"]');
			expect(coverPickers.length).toBeGreaterThan(0);
			await coverPickers[0].trigger("click");
			// The picker's `open` prop flips to true (rendered, not a setup
			// snapshot). There are two MediaPickerModal instances (content
			// toolbar + cover); the cover button must open the cover one.
			const pickers = wrapper.findAll('[data-testid="media-picker"]');
			expect(pickers.some((p) => p.attributes("data-open") === "true")).toBe(true);
			// And picking on the OPEN picker fills the cover field.
			const openPicker = pickers.find((p) => p.attributes("data-open") === "true")!;
			await openPicker.find("button").trigger("click");

			expect((wrapper.find("#cover_image").element as HTMLInputElement).value).toBe(
				"/static/uploads/2026/07/x.png",
			);
		});
	});

	describe("Web Push notify (DEC-055)", () => {
		beforeEach(() => {
			setupRoute("1"); // existing post — published=true shows the notify button
			setupMocks();
			mockNotifyPushSubscribers.mockResolvedValue({ total: 1, sent: 1, failed: 0, removed: 0 });
		});

		it("renders the notify button for a published post", async () => {
			const PostEditor = await loadPage();
			const wrapper = await mountWithSuspense(PostEditor);
			expect(wrapper.text()).toContain("通知订阅者");
		});

		it("sends a notification when the notify button is clicked", async () => {
			const PostEditor = await loadPage();
			const wrapper = await mountWithSuspense(PostEditor);

			const notifyBtn = wrapper.findAll("button").find((b) => b.text().includes("通知订阅者"));
			expect(notifyBtn).toBeDefined();
			await notifyBtn?.trigger("click");
			await flushPromises();

			expect(mockNotifyPushSubscribers).toHaveBeenCalled();
			const [payload] = mockNotifyPushSubscribers.mock.calls[0] as [
				{ title: string; body: string; url: string },
			];
			expect(payload.title).toBe("Existing Post");
			expect(payload.url).toBe("/posts/existing-post");
			expect(wrapper.text()).toContain("已通知订阅者");
		});

		it("shows a failure message when notification dispatch fails", async () => {
			mockNotifyPushSubscribers.mockRejectedValue(new Error("boom"));
			const PostEditor = await loadPage();
			const wrapper = await mountWithSuspense(PostEditor);

			const notifyBtn = wrapper.findAll("button").find((b) => b.text().includes("通知订阅者"));
			await notifyBtn?.trigger("click");
			await flushPromises();

			expect(wrapper.text()).toContain("通知发送失败");
		});
	});

	describe("Series assignment (DEC-056, TASK-123)", () => {
		beforeEach(() => {
			setupMocks();
		});

		it("renders the series selector with available series", async () => {
			setupRoute("new");
			const PostEditor = await loadPage();
			const wrapper = await mountWithSuspense(PostEditor);

			expect(wrapper.text()).toContain("系列");
			expect(wrapper.text()).toContain("无系列");
			expect(wrapper.text()).toContain("Deep Dive");
			expect(wrapper.text()).toContain("Nuxt 3 Essentials");
		});

		it("populates the series dropdown from an assigned post (edit mode)", async () => {
			setupRoute("1");
			const PostEditor = await loadPage();
			const wrapper = await mountWithSuspense(PostEditor);

			// mockExistingPost has series_id 2 (Deep Dive) — the order input
			// should be enabled and carry the stored position.
			const selects = wrapper.findAll("select");
			const seriesSelect = selects[selects.length - 1];
			expect((seriesSelect.element as HTMLSelectElement).value).toBe("2");
			const orderInput = wrapper.find('input[type="number"]');
			expect((orderInput.element as HTMLInputElement).value).toBe("3");
		});

		it("submits series_id and series_order on create", async () => {
			setupRoute("new");
			const PostEditor = await loadPage();
			const wrapper = await mountWithSuspense(PostEditor);

			const titleInput = wrapper.find('input[type="text"]');
			await titleInput.setValue("Series Member Post");
			const slugInput = wrapper.findAll('input[type="text"]')[1];
			await slugInput.setValue("series-member-post");
			const contentTextarea = wrapper.find("textarea");
			await contentTextarea.setValue("# Content");

			// pick Deep Dive (id 2) and set order 4
			const selects = wrapper.findAll("select");
			const seriesSelect = selects[selects.length - 1];
			await seriesSelect.setValue("2");
			const orderInput = wrapper.find('input[type="number"]');
			await orderInput.setValue("4");
			await flushPromises();

			const form = wrapper.find("form");
			await form.trigger("submit.prevent");
			await flushPromises();

			expect(mockCreateAdminPost).toHaveBeenCalled();
			// last call — earlier tests in the file already submitted creates
			const [payload] = mockCreateAdminPost.mock.calls.at(-1) as any[];
			expect(payload.series_id).toBe(2);
			expect(payload.series_order).toBe(4);
		});

		it("clears series_order when the series membership is removed", async () => {
			setupRoute("1");
			const PostEditor = await loadPage();
			const wrapper = await mountWithSuspense(PostEditor);

			// assign order 3, then clear the series back to "无系列" ('' value)
			const selects = wrapper.findAll("select");
			const seriesSelect = selects[selects.length - 1];
			await seriesSelect.setValue("");
			await flushPromises();

			const orderInput = wrapper.find('input[type="number"]');
			expect((orderInput.element as HTMLInputElement).value).toBe("0");

			const form = wrapper.find("form");
			await form.trigger("submit.prevent");
			await flushPromises();

			expect(mockUpdateAdminPost).toHaveBeenCalled();
			// last call — earlier tests in the file already submitted updates
			const [id, payload] = mockUpdateAdminPost.mock.calls.at(-1) as any[];
			expect(id).toBe(1);
			expect(payload.series_id).toBeUndefined();
			expect(payload.series_order).toBe(0);
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

		it("preview renders CONVERTED markdown, not raw source (RIL TASK-043, ISS-030)", async () => {
			const PostEditor = await loadPage();
			// Register the REAL MarkdownContent (the same component the public
			// /posts/[slug] page uses) so the preview is exercised for real.
			const wrapper = await mountWithSuspense(PostEditor, {
				MarkdownContent,
			});
			await flushPromises();

			// Type markdown into the CONTENT textarea (rows=15 — the excerpt
			// textarea appears first in the DOM), then switch to preview.
			const textarea = wrapper.find('textarea[rows="15"]');
			await textarea.setValue("**加粗文本** and `inline code`");
			await flushPromises();

			const buttons = wrapper.findAll('button[type="button"]');
			const toggleBtn = buttons.find((b) => b.text().includes("预览"));
			expect(toggleBtn).toBeDefined();
			await toggleBtn.trigger("click");
			await flushPromises();

			const html = wrapper.html();
			// Converted markdown: **bold** becomes <strong>, not literal source.
			expect(html).toContain("<strong>加粗文本</strong>");
			expect(html).not.toContain("**加粗文本**");
			// Sanitization still applies: dangerous markup in source is stripped.
			expect(html).not.toContain("<script>");
		});

		it("renders image upload file input", async () => {
			const PostEditor = await loadPage();
			const wrapper = await mountWithSuspense(PostEditor);
			const fileInput = wrapper.find('input[type="file"]');
			expect(fileInput.exists()).toBe(true);
		});

		it("wraps the selected text in bold via the toolbar", async () => {
			const PostEditor = await loadPage();
			const wrapper = await mountWithSuspense(PostEditor);
			const textarea = wrapper.find('textarea[rows="15"]');
			await textarea.setValue("hello");
			textarea.element.setSelectionRange(0, 5);
			const boldBtn = wrapper.findAll('button[type="button"]').find((b) => b.text().trim() === "B");
			expect(boldBtn).toBeDefined();
			await boldBtn.trigger("click");
			await flushPromises();
			expect((textarea.element as HTMLTextAreaElement).value).toBe("**hello**");
		});

		it("inserts a heading at the cursor via the toolbar", async () => {
			const PostEditor = await loadPage();
			const wrapper = await mountWithSuspense(PostEditor);
			const textarea = wrapper.find('textarea[rows="15"]');
			await textarea.setValue("Title");
			textarea.element.setSelectionRange(0, 0);
			const h1Btn = wrapper.findAll('button[type="button"]').find((b) => b.text().trim() === "H1");
			expect(h1Btn).toBeDefined();
			await h1Btn.trigger("click");
			await flushPromises();
			expect((textarea.element as HTMLTextAreaElement).value).toBe("# Title");
		});

		it("inserts a link cursor at the edit position via the toolbar", async () => {
			const PostEditor = await loadPage();
			const wrapper = await mountWithSuspense(PostEditor);
			const textarea = wrapper.find('textarea[rows="15"]');
			await textarea.setValue("");
			const linkBtn = wrapper
				.findAll('button[type="button"]')
				.find((b) => b.attributes("title") === "链接");
			expect(linkBtn).toBeDefined();
			await linkBtn.trigger("click");
			await flushPromises();
			expect((textarea.element as HTMLTextAreaElement).value).toContain("[");
			expect((textarea.element as HTMLTextAreaElement).value).toContain("](url)");
		});
	});

	describe("Unsaved-changes guard", () => {
		afterEach(() => {
			vi.restoreAllMocks();
			vi.unstubAllGlobals();
		});

		async function freshGuard() {
			// Reset the module graph so the vue-router mock and component
			// re-evaluate cleanly, then re-establish the shared stubs.
			capturedRouteLeave = null;
			vi.resetModules();
			vi.stubGlobal("useRuntimeConfig", () => ({
				public: { apiUrl: "http://localhost:18888" },
			}));
			vi.stubGlobal("useHead", vi.fn());
			vi.stubGlobal("definePageMeta", vi.fn());
			vi.stubGlobal(
				"confirm",
				vi.fn(() => true),
			);
			setupRoute();
			setupMocks();
			const { default: PostEditor } = await import("@/pages/admin/posts/[id].vue");
			const wrapper = await mountWithSuspense(PostEditor);
			await flushPromises();
			return wrapper;
		}

		it("does NOT confirm on leave when the form is untouched", async () => {
			const wrapper = await freshGuard();
			expect(typeof capturedRouteLeave).toBe("function");
			const allowed = (capturedRouteLeave as () => boolean)();
			expect(globalThis.confirm as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
			expect(allowed).toBe(true);
		});

		it("flushes an auto-save instead of blocking when leaving with edits (TASK-190)", async () => {
			const wrapper = await freshGuard();
			// Make an edit to a dirty field
			const titleInput = wrapper.find('input[type="text"]');
			expect(titleInput.exists()).toBe(true);
			await titleInput.setValue("Changed Title");
			await flushPromises();

			const decided = (capturedRouteLeave as () => boolean)();
			await flushPromises();
			// Auto-save persists the edit instead of prompting to abandon it…
			expect(globalThis.confirm).not.toHaveBeenCalled();
			expect(mockCreateAdminPost).toHaveBeenCalled();
			// …and navigation proceeds.
			expect(decided).toBe(true);
		});
	});

	describe("Draft auto-save (TASK-190)", () => {
		beforeEach(() => {
			vi.useFakeTimers();
			// The module-level mocks accumulate call history across tests;
			// clear them so each auto-save test asserts its own calls only.
			mockCreateAdminPost.mockClear();
			mockUpdateAdminPost.mockClear();
		});
		afterEach(() => {
			vi.useRealTimers();
			vi.restoreAllMocks();
			vi.unstubAllGlobals();
		});

		async function autosavePage(routeId = "new") {
			const mockNavigateTo = vi.fn();
			vi.stubGlobal("navigateTo", mockNavigateTo);
			vi.stubGlobal("useRuntimeConfig", () => ({
				public: { apiUrl: "http://localhost:18888" },
			}));
			vi.stubGlobal("useHead", vi.fn());
			vi.stubGlobal("definePageMeta", vi.fn());
			setupRoute(routeId);
			setupMocks();
			mockCreateAdminPost.mockResolvedValue({ id: 7 });
			mockUpdateAdminPost.mockResolvedValue({ id: 7 });
			const PostEditor = await loadPage();
			const wrapper = await mountWithSuspense(PostEditor);
			await flushPromises();
			return { wrapper, mockNavigateTo };
		}

		it("auto-creates a draft (with a derived slug) after the debounce and navigates to it", async () => {
			const { wrapper, mockNavigateTo } = await autosavePage("new");

			const titleInput = wrapper.find('input[type="text"]');
			await titleInput.setValue("My Auto Draft");
			const contentTextarea = wrapper.find('textarea[rows="15"]');
			await contentTextarea.setValue("# Draft body");
			await vi.advanceTimersByTimeAsync(1000);
			await flushPromises();

			expect(mockCreateAdminPost).toHaveBeenCalledTimes(1);
			const [payload] = mockCreateAdminPost.mock.calls[0] as any[];
			expect(payload.title).toBe("My Auto Draft");
			expect(payload.slug).toBe("my-auto-draft");
			expect(payload.content).toBe("# Draft body");
			expect(wrapper.find('[data-testid="autosave-status"]').text()).toContain("已自动保存");
			expect(mockNavigateTo).toHaveBeenCalledWith("/admin/posts/7", { replace: true });
		});

		it("updates (not re-creates) the draft on later edits", async () => {
			const { wrapper } = await autosavePage("new");

			const titleInput = wrapper.find('input[type="text"]');
			await titleInput.setValue("My Auto Draft");
			await vi.advanceTimersByTimeAsync(1000);
			await flushPromises();
			expect(mockCreateAdminPost).toHaveBeenCalledTimes(1);

			const contentTextarea = wrapper.find('textarea[rows="15"]');
			await contentTextarea.setValue("# Edits");
			await vi.advanceTimersByTimeAsync(1000);
			await flushPromises();

			expect(mockCreateAdminPost).toHaveBeenCalledTimes(1);
			expect(mockUpdateAdminPost).toHaveBeenCalledWith(
				7,
				expect.objectContaining({ content: "# Edits" }),
			);
		});

		it("auto-saves edits to an existing post via the update endpoint", async () => {
			const { wrapper } = await autosavePage("1");

			const titleInput = wrapper.find('input[type="text"]');
			await titleInput.setValue("Existing Updated");
			await vi.advanceTimersByTimeAsync(1000);
			await flushPromises();

			expect(mockUpdateAdminPost).toHaveBeenCalledWith(
				1,
				expect.objectContaining({ title: "Existing Updated" }),
			);
			expect(wrapper.find('[data-testid="autosave-status"]').text()).toContain("已自动保存");
		});

		it("coalesces a burst of edits into a single save", async () => {
			const { wrapper } = await autosavePage("1");

			const titleInput = wrapper.find('input[type="text"]');
			await titleInput.setValue("T1");
			await vi.advanceTimersByTimeAsync(400);
			await titleInput.setValue("T2");
			await vi.advanceTimersByTimeAsync(400);
			await titleInput.setValue("T3");
			await vi.advanceTimersByTimeAsync(1000);
			await flushPromises();

			expect(mockUpdateAdminPost).toHaveBeenCalledTimes(1);
			expect(mockUpdateAdminPost).toHaveBeenCalledWith(1, expect.objectContaining({ title: "T3" }));
		});

		it("shows an error state when the auto-save fails", async () => {
			const { wrapper } = await autosavePage("new");
			mockCreateAdminPost.mockRejectedValue({ data: { detail: "Slug taken" } });

			const titleInput = wrapper.find('input[type="text"]');
			await titleInput.setValue("Collision Draft");
			await vi.advanceTimersByTimeAsync(1000);
			await flushPromises();

			expect(wrapper.find('[data-testid="autosave-status"]').text()).toContain("Slug taken");
		});
	});

	describe("Version history (TASK-191)", () => {
		beforeEach(() => {
			setupRoute("1");
			setupMocks();
			vi.stubGlobal("useRuntimeConfig", () => ({
				public: { apiUrl: "http://localhost:18888" },
			}));
			vi.stubGlobal("useHead", vi.fn());
			vi.stubGlobal("definePageMeta", vi.fn());
			mockFetchPostRevisions.mockResolvedValue([
				{ id: 2, created_at: "2026-01-02T00:00:00Z", title: "existing-post", published: false },
				{ id: 1, created_at: "2026-01-01T00:00:00Z", title: "existing-post", published: false },
			]);
			mockRestorePostRevision.mockResolvedValue({ id: 1 });
		});
		afterEach(() => {
			vi.restoreAllMocks();
			mockFetchPostRevisions.mockClear();
			mockRestorePostRevision.mockClear();
		});

		async function mountEdit(refreshFn?: ReturnType<typeof vi.fn>) {
			mockFetchAdminPost.mockReturnValue({
				data: ref(mockExistingPost),
				pending: ref(false),
				error: ref(null),
				refresh: refreshFn ?? vi.fn(),
			});
			const PostEditor = await loadPage();
			const wrapper = await mountWithSuspense(PostEditor);
			await flushPromises();
			return wrapper;
		}

		it("renders the history panel only for an existing post and lists revisions when opened", async () => {
			const wrapper = await mountEdit();
			expect(wrapper.find('[data-testid="revision-history"]').exists()).toBe(true);
			expect(wrapper.text()).toContain("版本历史");

			await wrapper.find('[data-testid="revision-toggle"]').trigger("click");
			await flushPromises();

			expect(mockFetchPostRevisions).toHaveBeenCalledWith(1);
			expect(wrapper.findAll('[data-testid="revision-row"]').length).toBe(2);
			expect(wrapper.find('[data-testid="revision-row"]').text()).toContain("恢复此版本");
		});

		it("restores a revision and reloads the live post", async () => {
			const refreshFn = vi.fn();
			const wrapper = await mountEdit(refreshFn);
			await wrapper.find('[data-testid="revision-toggle"]').trigger("click");
			await flushPromises();

			const restoreBtn = wrapper.findAll("button").find((b) => b.text().includes("恢复此版本"));
			expect(restoreBtn).toBeDefined();
			await restoreBtn?.trigger("click");
			await flushPromises();

			expect(mockRestorePostRevision).toHaveBeenCalledWith(1, 2); // newest revision id
			expect(refreshFn).toHaveBeenCalled();
			expect(wrapper.find('[data-testid="revision-message"]').text()).toContain("已恢复所选版本");
		});
	});
});
