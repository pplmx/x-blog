import { flushPromises } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import { mountWithSuspense } from "./helpers.ts";

const { mockFetchAdminPosts, mockDeleteAdminPost } = vi.hoisted(() => ({
	mockFetchAdminPosts: vi.fn(),
	mockDeleteAdminPost: vi.fn(),
}));

vi.mock("~/composables/useApi", () => ({
	fetchAdminPosts: mockFetchAdminPosts,
	deleteAdminPost: mockDeleteAdminPost,
}));

vi.stubGlobal("useRuntimeConfig", () => ({
	public: { apiUrl: "http://localhost:18888" },
}));
vi.stubGlobal("navigateTo", vi.fn());
vi.stubGlobal("useHead", vi.fn());

const originalConfirm = window.confirm;

const mockResponse = {
	items: [
		{
			id: 1,
			title: "First Post",
			slug: "first-post",
			published: true,
			pinned: false,
			publish_at: null,
			views: 100,
			cover_image: null,
			category: "Tech",
			tags: ["React"],
			created_at: "2024-01-15T10:30:00Z",
			updated_at: "2024-01-15T10:30:00Z",
		},
		{
			id: 2,
			title: "Draft Post",
			slug: "draft-post",
			published: false,
			pinned: false,
			publish_at: null,
			views: 0,
			cover_image: null,
			category: "Design",
			tags: [],
			created_at: "2024-02-20T14:00:00Z",
			updated_at: "2024-02-20T14:00:00Z",
		},
		{
			id: 3,
			title: "Scheduled Post",
			slug: "scheduled-post",
			published: false,
			pinned: false,
			publish_at: "2026-08-01T10:00:00Z",
			views: 0,
			cover_image: null,
			category: "Tech",
			tags: [],
			created_at: "2026-07-28T10:00:00Z",
			updated_at: "2026-07-28T10:00:00Z",
		},
	],
	pagination: { total: 3, skip: 0, limit: 20 },
};

async function loadPage() {
	const { default: PostsPage } = await import("@/pages/admin/posts.vue");
	return PostsPage;
}

describe("Admin Posts Page", () => {
	afterEach(() => {
		vi.restoreAllMocks();
		window.confirm = originalConfirm;
	});

	describe("Loading state", () => {
		it("renders loading message when posts are pending", async () => {
			mockFetchAdminPosts.mockReturnValue({
				data: ref(null),
				pending: ref(true),
				error: ref(null),
				refresh: vi.fn(),
			});

			const PostsPage = await loadPage();
			const wrapper = await mountWithSuspense(PostsPage);
			expect(wrapper.text()).toContain("加载中");
		});
	});

	describe("Error state", () => {
		it("renders error message when fetch fails", async () => {
			mockFetchAdminPosts.mockReturnValue({
				data: ref(null),
				pending: ref(false),
				error: ref({ message: "Network error" }),
				refresh: vi.fn(),
			});

			const PostsPage = await loadPage();
			const wrapper = await mountWithSuspense(PostsPage);
			expect(wrapper.text()).toContain("Network error");
		});
	});

	describe("Empty state", () => {
		it("renders empty state when no posts exist", async () => {
			mockFetchAdminPosts.mockReturnValue({
				data: ref({ items: [], pagination: { total: 0, skip: 0, limit: 20 } }),
				pending: ref(false),
				error: ref(null),
				refresh: vi.fn(),
			});

			const PostsPage = await loadPage();
			const wrapper = await mountWithSuspense(PostsPage);
			expect(wrapper.text()).toContain("暂无文章");
		});

		it("renders a link to create new post in empty state", async () => {
			mockFetchAdminPosts.mockReturnValue({
				data: ref({ items: [], pagination: { total: 0, skip: 0, limit: 20 } }),
				pending: ref(false),
				error: ref(null),
				refresh: vi.fn(),
			});

			const PostsPage = await loadPage();
			const wrapper = await mountWithSuspense(PostsPage);
			const createLink = wrapper.find('a[href="/admin/posts/new"]');
			expect(createLink.exists()).toBe(true);
		});
	});

	describe("Populated state", () => {
		beforeEach(() => {
			mockFetchAdminPosts.mockReturnValue({
				data: ref(mockResponse),
				pending: ref(false),
				error: ref(null),
				refresh: vi.fn(),
			});
		});

		afterEach(() => {
			vi.clearAllMocks();
		});

		it("renders the page heading", async () => {
			const PostsPage = await loadPage();
			const wrapper = await mountWithSuspense(PostsPage);
			expect(wrapper.text()).toContain("文章管理");
		});

		it("renders the post count", async () => {
			const PostsPage = await loadPage();
			const wrapper = await mountWithSuspense(PostsPage);
			expect(wrapper.text()).toContain("3 篇文章");
		});

		it('renders a "new post" link', async () => {
			const PostsPage = await loadPage();
			const wrapper = await mountWithSuspense(PostsPage);
			const createLink = wrapper.find('a[href="/admin/posts/new"]');
			expect(createLink.exists()).toBe(true);
		});

		it("renders post titles in the table", async () => {
			const PostsPage = await loadPage();
			const wrapper = await mountWithSuspense(PostsPage);
			expect(wrapper.text()).toContain("First Post");
			expect(wrapper.text()).toContain("Draft Post");
		});

		it("renders published status for published posts", async () => {
			const PostsPage = await loadPage();
			const wrapper = await mountWithSuspense(PostsPage);
			expect(wrapper.text()).toContain("已发布");
		});

		it("renders draft status for unpublished posts", async () => {
			const PostsPage = await loadPage();
			const wrapper = await mountWithSuspense(PostsPage);
			expect(wrapper.text()).toContain("草稿");
		});

		it("renders scheduled status for scheduled posts", async () => {
			const PostsPage = await loadPage();
			const wrapper = await mountWithSuspense(PostsPage);
			expect(wrapper.text()).toContain("定时发布");
		});

		it("renders post dates", async () => {
			const PostsPage = await loadPage();
			const wrapper = await mountWithSuspense(PostsPage);
			expect(wrapper.text()).toContain("2024");
		});

		it("renders edit links for each post", async () => {
			const PostsPage = await loadPage();
			const wrapper = await mountWithSuspense(PostsPage);
			const editLink = wrapper.find('a[href="/admin/posts/1"]');
			expect(editLink.exists()).toBe(true);
		});

		it("renders search input and status filter", async () => {
			const PostsPage = await loadPage();
			const wrapper = await mountWithSuspense(PostsPage);
			const searchInput = wrapper.find('input[type="text"]');
			expect(searchInput.element.getAttribute("placeholder")).toContain("搜索");
			expect(wrapper.text()).toContain("全部状态");
			expect(wrapper.text()).toContain("已发布");
			expect(wrapper.text()).toContain("草稿");
			expect(wrapper.text()).toContain("定时发布");
		});

		it("calls deleteAdminPost with confirmation when delete is clicked", async () => {
			window.confirm = vi.fn(() => true);
			mockDeleteAdminPost.mockResolvedValue({});

			const refreshMock = vi.fn();
			mockFetchAdminPosts.mockReturnValue({
				data: ref(mockResponse),
				pending: ref(false),
				error: ref(null),
				refresh: refreshMock,
			});

			const PostsPage = await loadPage();
			const wrapper = await mountWithSuspense(PostsPage);

			const deleteButtons = wrapper.findAll("button");
			const trashButton = deleteButtons.find((b) => {
				const svg = b.find('svg[data-icon="lucide:trash-2"]');
				return svg.exists();
			});

			expect(trashButton).toBeDefined();
			await trashButton?.trigger("click");
			await flushPromises();

			expect(window.confirm).toHaveBeenCalledWith("确定要删除这篇文章吗？");
			expect(mockDeleteAdminPost).toHaveBeenCalledWith(1);
		});

		it("does NOT call deleteAdminPost when confirmation is cancelled", async () => {
			window.confirm = vi.fn(() => false);

			const PostsPage = await loadPage();
			const wrapper = await mountWithSuspense(PostsPage);

			const deleteButtons = wrapper.findAll("button");
			const trashButton = deleteButtons.find((b) => {
				const svg = b.find('svg[data-icon="lucide:trash-2"]');
				return svg.exists();
			});

			await trashButton?.trigger("click");
			expect(mockDeleteAdminPost).not.toHaveBeenCalled();
		});
	});
});
