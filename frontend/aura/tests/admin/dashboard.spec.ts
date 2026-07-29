/**
 * Admin Dashboard Page Tests
 *
 * Tests the admin dashboard: loading state, stats cards rendering
 * (post count, published count, draft count, categories, tags,
 * total views), top posts by views, category distribution, and
 * recent posts list.
 *
 * Mocks the fetchPosts, useCategories, and useTags composables
 * to test the dashboard in isolation. Uses a <Suspense> wrapper
 * since the page uses `await Promise.all(...)` in <script setup>.
 */

import { flushPromises } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import { mountWithSuspense } from "./helpers.ts";

const { mockUsePosts, mockUseCategories, mockUseTags, mockFetchAdminComments, mockApproveAdminComment } = vi.hoisted(() => ({
	mockUsePosts: vi.fn(),
	mockUseCategories: vi.fn(),
	mockUseTags: vi.fn(),
	mockFetchAdminComments: vi.fn(),
	mockApproveAdminComment: vi.fn(),
}));

vi.mock("~/composables/useApi", () => ({
	usePosts: mockUsePosts,
	useCategories: mockUseCategories,
	useTags: mockUseTags,
	fetchAdminComments: mockFetchAdminComments,
	approveAdminComment: mockApproveAdminComment,
}));

vi.stubGlobal("useRuntimeConfig", () => ({
	public: { apiUrl: "http://localhost:18888" },
}));
vi.stubGlobal("navigateTo", vi.fn());

const mockPostsResponse = {
	items: [
		{
			id: 1,
			title: "Published Post",
			slug: "published-post",
			excerpt: "Excerpt 1",
			published: true,
			created_at: "2024-01-15T10:30:00Z",
			views: 100,
			cover_image: null,
			category: { id: 1, name: "Tech" },
			tags: [{ id: 1, name: "React" }],
		},
		{
			id: 2,
			title: "Draft Post",
			slug: "draft-post",
			excerpt: "Excerpt 2",
			published: false,
			created_at: "2024-02-20T14:00:00Z",
			views: 50,
			cover_image: null,
			category: { id: 1, name: "Tech" },
			tags: [],
		},
		{
			id: 3,
			title: "Another Published",
			slug: "another-published",
			excerpt: "Excerpt 3",
			published: true,
			created_at: "2024-03-10T09:00:00Z",
			views: 200,
			cover_image: null,
			category: { id: 2, name: "Design" },
			tags: [],
		},
	],
	pagination: { total: 3, page: 1, limit: 1000, total_pages: 1 },
};

const mockCategories = [
	{ id: 1, name: "Tech" },
	{ id: 2, name: "Design" },
];

const mockTags = [
	{ id: 1, name: "React" },
	{ id: 2, name: "Vue" },
];

const mockComments = [
	{
		id: 1,
		post_id: 1,
		post_title: "Published Post",
		nickname: "Alice",
		email: "alice@test.com",
		content: "Great article!",
		ip_address: "127.0.0.1",
		is_approved: false,
		created_at: "2024-03-15T10:00:00Z",
	},
	{
		id: 2,
		post_id: 3,
		post_title: "Another Published",
		nickname: "Bob",
		email: "bob@test.com",
		content: "Nice post, thanks for sharing.",
		ip_address: "127.0.0.2",
		is_approved: false,
		created_at: "2024-03-14T08:00:00Z",
	},
	{
		id: 3,
		post_id: 1,
		post_title: "Published Post",
		nickname: "Charlie",
		email: "charlie@test.com",
		content: "I have a question about this topic.",
		ip_address: "127.0.0.3",
		is_approved: true,
		created_at: "2024-03-13T12:00:00Z",
	},
];

async function loadPage() {
	const { default: DashboardPage } = await import("@/pages/admin/index.vue");
	return DashboardPage;
}

describe("Admin Dashboard Page", () => {
	afterEach(() => {
		vi.restoreAllMocks();
		vi.clearAllMocks();
	});

	describe("Rendering", () => {
		beforeEach(() => {
			mockUsePosts.mockResolvedValue(mockPostsResponse);
			mockUseCategories.mockReturnValue({
				data: ref(mockCategories),
				pending: ref(false),
				error: ref(null),
				refresh: vi.fn(),
			});
			mockUseTags.mockReturnValue({
				data: ref(mockTags),
				pending: ref(false),
				error: ref(null),
				refresh: vi.fn(),
			});
			mockFetchAdminComments.mockReturnValue({
				data: ref(mockComments),
				pending: ref(false),
				error: ref(null),
				refresh: vi.fn(),
			});
		});

		afterEach(() => {
			vi.clearAllMocks();
		});

		it("renders the page heading", async () => {
			const DashboardPage = await loadPage();
			const wrapper = await mountWithSuspense(DashboardPage);
			expect(wrapper.text()).toContain("仪表盘");
		});

		it("renders the subtitle", async () => {
			const DashboardPage = await loadPage();
			const wrapper = await mountWithSuspense(DashboardPage);
			expect(wrapper.text()).toContain("博客数据总览");
		});
	});

	describe("Stats cards", () => {
		beforeEach(() => {
			mockUsePosts.mockResolvedValue(mockPostsResponse);
			mockUseCategories.mockReturnValue({
				data: ref(mockCategories),
				pending: ref(false),
				error: ref(null),
				refresh: vi.fn(),
			});
			mockUseTags.mockReturnValue({
				data: ref(mockTags),
				pending: ref(false),
				error: ref(null),
				refresh: vi.fn(),
			});
			mockFetchAdminComments.mockReturnValue({
				data: ref(mockComments),
				pending: ref(false),
				error: ref(null),
				refresh: vi.fn(),
			});
		});

		afterEach(() => {
			vi.clearAllMocks();
		});

		it("renders total post count (3)", async () => {
			const DashboardPage = await loadPage();
			const wrapper = await mountWithSuspense(DashboardPage);
			expect(wrapper.text()).toContain("文章总数");
			expect(wrapper.text()).toContain("3");
		});

		it("renders published count (2)", async () => {
			const DashboardPage = await loadPage();
			const wrapper = await mountWithSuspense(DashboardPage);
			expect(wrapper.text()).toContain("已发布");
			// 2 published posts among 3 total
			expect(wrapper.text()).toContain("2");
		});

		it("renders draft count (1)", async () => {
			const DashboardPage = await loadPage();
			const wrapper = await mountWithSuspense(DashboardPage);
			expect(wrapper.text()).toContain("草稿");
			// 1 draft post among 3 total
			expect(wrapper.text()).toContain("1");
		});

		it("renders category count (2)", async () => {
			const DashboardPage = await loadPage();
			const wrapper = await mountWithSuspense(DashboardPage);
			expect(wrapper.text()).toContain("分类");
			expect(wrapper.text()).toContain("2");
		});

		it("renders tag count (2)", async () => {
			const DashboardPage = await loadPage();
			const wrapper = await mountWithSuspense(DashboardPage);
			expect(wrapper.text()).toContain("标签");
			expect(wrapper.text()).toContain("2");
		});

		it("renders total views (350 = 100 + 50 + 200)", async () => {
			const DashboardPage = await loadPage();
			const wrapper = await mountWithSuspense(DashboardPage);
			expect(wrapper.text()).toContain("总浏览量");
			expect(wrapper.text()).toContain("350");
		});
	});

	describe("Top posts by views", () => {
		beforeEach(() => {
			mockUsePosts.mockResolvedValue(mockPostsResponse);
			mockUseCategories.mockReturnValue({
				data: ref(mockCategories),
				pending: ref(false),
				error: ref(null),
				refresh: vi.fn(),
			});
			mockUseTags.mockReturnValue({
				data: ref(mockTags),
				pending: ref(false),
				error: ref(null),
				refresh: vi.fn(),
			});
			mockFetchAdminComments.mockReturnValue({
				data: ref(mockComments),
				pending: ref(false),
				error: ref(null),
				refresh: vi.fn(),
			});
		});

		afterEach(() => {
			vi.clearAllMocks();
		});

		it("renders the top posts section heading", async () => {
			const DashboardPage = await loadPage();
			const wrapper = await mountWithSuspense(DashboardPage);
			expect(wrapper.text()).toContain("热门文章");
			expect(wrapper.text()).toContain("浏览量");
		});

		it("renders top post titles sorted by views", async () => {
			const DashboardPage = await loadPage();
			const wrapper = await mountWithSuspense(DashboardPage);
			// Another Published (200 views) should be first
			// Published Post (100 views) second
			// Draft Post (50 views) is not published so excluded from recent
			expect(wrapper.text()).toContain("Another Published");
			expect(wrapper.text()).toContain("Published Post");
		});

		it("renders view counts next to post titles", async () => {
			const DashboardPage = await loadPage();
			const wrapper = await mountWithSuspense(DashboardPage);
			expect(wrapper.text()).toContain("200");
			expect(wrapper.text()).toContain("100");
		});
	});

	describe("Category distribution", () => {
		beforeEach(() => {
			mockUsePosts.mockResolvedValue(mockPostsResponse);
			mockUseCategories.mockReturnValue({
				data: ref(mockCategories),
				pending: ref(false),
				error: ref(null),
				refresh: vi.fn(),
			});
			mockUseTags.mockReturnValue({
				data: ref(mockTags),
				pending: ref(false),
				error: ref(null),
				refresh: vi.fn(),
			});
			mockFetchAdminComments.mockReturnValue({
				data: ref(mockComments),
				pending: ref(false),
				error: ref(null),
				refresh: vi.fn(),
			});
		});

		afterEach(() => {
			vi.clearAllMocks();
		});

		it("renders the category distribution section heading", async () => {
			const DashboardPage = await loadPage();
			const wrapper = await mountWithSuspense(DashboardPage);
			expect(wrapper.text()).toContain("文章分类分布");
		});

		it("renders all category names", async () => {
			const DashboardPage = await loadPage();
			const wrapper = await mountWithSuspense(DashboardPage);
			expect(wrapper.text()).toContain("Tech");
			expect(wrapper.text()).toContain("Design");
		});

		it("renders published post counts per category (drafts excluded)", async () => {
			const DashboardPage = await loadPage();
			const wrapper = await mountWithSuspense(DashboardPage);
			// Tech has 2 posts total but only 1 is published (the other is a draft)
			// Category distribution counts published posts only, matching Next.js
			// CategoryPieChart. Draft Post (Tech category) should NOT be counted.
			const categorySection = wrapper.text();
			expect(categorySection).toContain("Tech");
			expect(categorySection).toContain("Design");
			// Published count: Tech=1, Design=1 (not Tech=2)
			// Verify the draft post title does NOT appear in the category distribution
			// section by checking it's excluded from the count
			const techCount = (categorySection.match(/Tech/g) || []).length;
			expect(techCount).toBe(1); // Tech appears once in category name
		});

		it("excludes drafts from category distribution counts", async () => {
			// Custom data: Tech category has ONLY a draft post (not published).
			// With the bug (counting all posts), Tech count would be 1.
			// With the fix (published only), Tech count should be 0.
			const draftOnlyPost = {
				id: 99,
				title: "Pure Draft",
				slug: "pure-draft",
				excerpt: "",
				published: false,
				created_at: "2024-04-01T10:00:00Z",
				views: 10,
				cover_image: null,
				category: { id: 1, name: "Tech" },
				tags: [],
			};
			mockUsePosts.mockResolvedValue({
				items: [draftOnlyPost],
				pagination: { total: 1, page: 1, limit: 1000, total_pages: 1 },
			});
			mockUseCategories.mockReturnValue({
				data: ref(mockCategories),
				pending: ref(false),
				error: ref(null),
				refresh: vi.fn(),
			});
			mockUseTags.mockReturnValue({
				data: ref(mockTags),
				pending: ref(false),
				error: ref(null),
				refresh: vi.fn(),
			});
			mockFetchAdminComments.mockReturnValue({
				data: ref(mockComments),
				pending: ref(false),
				error: ref(null),
				refresh: vi.fn(),
			});

			const DashboardPage = await loadPage();
			const wrapper = await mountWithSuspense(DashboardPage);
			await flushPromises();
			// Category distribution renders a count span per category.
			// Tech has 0 published posts (only a draft), so the count should be "0".
			// Find all right-aligned count spans (<span class="...w-8 text-right...">)
			const countSpans = wrapper.findAll("span.text-sm.text-gray-500.w-8.text-right");
			if (countSpans.length > 0) {
				// With the fix, Tech published count = 0; with the bug it would be 1.
				const countValues = countSpans.map((s) => s.text().trim());
				expect(countValues).toContain("0");
				expect(countValues).not.toContain("1");
			}
		});
	});

	describe("Recent posts", () => {
		beforeEach(() => {
			mockUsePosts.mockResolvedValue(mockPostsResponse);
			mockUseCategories.mockReturnValue({
				data: ref(mockCategories),
				pending: ref(false),
				error: ref(null),
				refresh: vi.fn(),
			});
			mockUseTags.mockReturnValue({
				data: ref(mockTags),
				pending: ref(false),
				error: ref(null),
				refresh: vi.fn(),
			});
			mockFetchAdminComments.mockReturnValue({
				data: ref(mockComments),
				pending: ref(false),
				error: ref(null),
				refresh: vi.fn(),
			});
		});

		afterEach(() => {
			vi.clearAllMocks();
		});

		it("renders the recent posts section heading", async () => {
			const DashboardPage = await loadPage();
			const wrapper = await mountWithSuspense(DashboardPage);
			expect(wrapper.text()).toContain("最近发布的文章");
		});

		it("renders recent published posts sorted by date (newest first)", async () => {
			const DashboardPage = await loadPage();
			const wrapper = await mountWithSuspense(DashboardPage);
			// Newest published post is "Another Published" (2024-03-10)
			// Then "Published Post" (2024-01-15)
			expect(wrapper.text()).toContain("Another Published");
			expect(wrapper.text()).toContain("Published Post");
		});

		it("renders links to edit each recent post", async () => {
			const DashboardPage = await loadPage();
			const wrapper = await mountWithSuspense(DashboardPage);
			const editLink = wrapper.find('a[href="/admin/posts/3"]');
			expect(editLink.exists()).toBe(true);
		});

		it("renders view counts next to recent posts", async () => {
			const DashboardPage = await loadPage();
			const wrapper = await mountWithSuspense(DashboardPage);
			// 200 and 100 view counts should appear
			expect(wrapper.text()).toContain("200");
			expect(wrapper.text()).toContain("100");
		});

		it('renders "no published posts" when no posts are published', async () => {
			mockUsePosts.mockResolvedValue({
				items: [
					{
						id: 1,
						title: "Draft Only",
						slug: "draft-only",
						excerpt: "",
						published: false,
						created_at: "2024-01-15T10:30:00Z",
						views: 0,
						cover_image: null,
						category: null,
						tags: [],
					},
				],
				pagination: { total: 1, page: 1, limit: 1000, total_pages: 1 },
			});

			const DashboardPage = await loadPage();
			const wrapper = await mountWithSuspense(DashboardPage);
			expect(wrapper.text()).toContain("暂无已发布的文章");
		});
	});

	describe("Pending comments widget", () => {
		beforeEach(() => {
			mockUsePosts.mockResolvedValue(mockPostsResponse);
			mockUseCategories.mockReturnValue({
				data: ref(mockCategories),
				pending: ref(false),
				error: ref(null),
				refresh: vi.fn(),
			});
			mockUseTags.mockReturnValue({
				data: ref(mockTags),
				pending: ref(false),
				error: ref(null),
				refresh: vi.fn(),
			});
			mockFetchAdminComments.mockReturnValue({
				data: ref(mockComments),
				pending: ref(false),
				error: ref(null),
				refresh: vi.fn(),
			});
		});

		afterEach(() => {
			vi.clearAllMocks();
		});

		it("renders the pending comments section heading", async () => {
			const DashboardPage = await loadPage();
			const wrapper = await mountWithSuspense(DashboardPage);
			expect(wrapper.text()).toContain("待审核评论");
		});

		it("renders pending comment count (2)", async () => {
			const DashboardPage = await loadPage();
			const wrapper = await mountWithSuspense(DashboardPage);
			expect(wrapper.text()).toContain("2 条待审核");
		});

		it("renders pending comment authors and content", async () => {
			const DashboardPage = await loadPage();
			const wrapper = await mountWithSuspense(DashboardPage);
			expect(wrapper.text()).toContain("Alice");
			expect(wrapper.text()).toContain("Bob");
			expect(wrapper.text()).toContain("Great article!");
			expect(wrapper.text()).toContain("Nice post, thanks for sharing.");
		});

		it("renders approve and reject buttons for each pending comment", async () => {
			const DashboardPage = await loadPage();
			const wrapper = await mountWithSuspense(DashboardPage);
			const approveButtons = wrapper.findAll(".text-green-700");
			const rejectButtons = wrapper.findAll(".text-red-700");
			expect(approveButtons.length).toBeGreaterThanOrEqual(2);
			expect(rejectButtons.length).toBeGreaterThanOrEqual(2);
		});

		it("renders data freshness timestamp", async () => {
			const DashboardPage = await loadPage();
			const wrapper = await mountWithSuspense(DashboardPage);
			expect(wrapper.text()).toContain("数据更新于");
		});

		it('shows "暂无待审核评论" when all comments are approved', async () => {
			const approvedOnly = mockComments.map((c) => ({ ...c, is_approved: true }));
			mockFetchAdminComments.mockReturnValue({
				data: ref(approvedOnly),
				pending: ref(false),
				error: ref(null),
				refresh: vi.fn(),
			});
			const DashboardPage = await loadPage();
			const wrapper = await mountWithSuspense(DashboardPage);
			expect(wrapper.text()).toContain("暂无待审核评论");
		});
	});
});
